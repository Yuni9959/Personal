"""Read-only, loopback-only Personal Tap operations monitor (standard library)."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import urlopen, Request

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = Path.home() / "Desktop"
ADMISSION = DESKTOP / "YML/7. analysis/university_admission_service_v0.6.1/runtime"
CHECKS = DESKTOP / "AI/admission-review-weekly-20261104"
ORIGINS = {"https://yuni9959.github.io", "http://127.0.0.1:8768", "http://localhost:8768"}
TASKS = {
    "Quant Data Update": ("시장 데이터 수집 · 게시", 9),
    "YML Admission Monitor": ("대입정보 수집 · 분석", 30),
    "Personal Tap AI Trend Research": ("AI Trend 한국어 생성", 18),
    "Google Drive Mount Health": ("Google Drive 연결", 1),
    "Futures Trade Auto Process": ("선물 CSV 처리", 1),
    "YML Admission Evidence Review": ("대입자료 해석 · 근거 검토", 3),
    "YML Weekly Operations Check": ("주간 데이터 · YML 페이지 점검", 192),
}
LOCK = threading.Lock()
STATUS_CACHE = None
STATUS_CACHE_AT = 0

def status_snapshot():
    """Share one fresh observation when the home and detail screens poll together."""
    global STATUS_CACHE, STATUS_CACHE_AT
    with LOCK:
        if STATUS_CACHE is None or time.monotonic() - STATUS_CACHE_AT >= 5:
            value = collect()
            STATUS_CACHE = value
            STATUS_CACHE_AT = time.monotonic()
        return STATUS_CACHE

def read_json(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}

def read_tail(path):
    try:
        with path.open("rb") as f:
            f.seek(max(0, path.stat().st_size - 200000))
            return f.read().decode("utf-8-sig", errors="replace")
    except OSError:
        return ""

def latest(directory, pattern):
    files = list(directory.glob(pattern))
    return max(files, key=lambda p: p.stat().st_mtime) if files else directory / "missing"

def observed(path):
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat() if path.is_file() else None

def classify(task, max_hours, now=None):
    now = now or datetime.now(timezone.utc)
    if not task:
        return "확인 불가"
    if task.get("state") == "Disabled":
        return "사용 안 함"
    if task.get("state") == "Running":
        return "실행 중"
    try:
        age = (now - datetime.fromisoformat(task["lastRun"])).total_seconds()
    except (ValueError, KeyError, TypeError):
        return "확인 불가"
    if age < -300 or age > max_hours * 3600:
        return "오래됨"
    return "최근 실행 성공" if task.get("result") == 0 else "실패"

def recent(value, seconds):
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(value)).total_seconds()
        return -300 <= age <= seconds
    except (ValueError, TypeError):
        return False

def admission_signal(job, receipt, health):
    report = receipt.get("report", {})
    counts = report.get("counts", {})
    if report.get("status") == "fail" or counts.get("errors", 0):
        job["severity"] = "error"
        job["reason"] = "승인 보고서 검사 오류"
    elif (job.get("state") == "Running" and receipt.get("status") == "healthy"
          and not receipt.get("issues") and report.get("status") == "pass"
          and counts.get("errors") == 0 and counts.get("institutions", 0) > 0
          and counts.get("complete_institutions") == counts.get("institutions")
          and health.get("coverage", {}).get("general_page_attachment_resource_warnings") == 0
          and recent(receipt.get("generated_at"), 30 * 3600)
          and recent(job.get("lastRun"), 2 * 3600)
          and recent(job.get("observedAt"), 3600)):
        job["status"] = "정상 실행 중"
        job["reason"] = "최근 보고서 검사 통과 · 수집/검토 진행 중"

def collect():
    script = r"""
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$ErrorActionPreference = 'Stop'
$worker = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
    $_.CommandLine -like '*university_admission_service_v0.6.1*' -and
    $_.CommandLine -match 'university_entry\.py.*--university\s+[a-z_]+'
} | Select-Object -First 1
$university = $null
$phase = $null
if ($worker -and $worker.CommandLine -match '--university\s+([a-z_]+)') {
    $university = $Matches[1]
    $phase = if ($worker.CommandLine -like '*--audit-only*') {'audit'} else {'collect'}
}
Get-ScheduledTask | Where-Object {$_.TaskName -in @('Quant Data Update','YML Admission Monitor','Personal Tap AI Trend Research','Google Drive Mount Health','Futures Trade Auto Process','YML Admission Evidence Review','YML Weekly Operations Check')} | ForEach-Object {
$i = $_ | Get-ScheduledTaskInfo
[pscustomobject]@{name=$_.TaskName;state=$_.State.ToString();lastRun=$i.LastRunTime.ToUniversalTime().ToString('o');nextRun=$i.NextRunTime.ToUniversalTime().ToString('o');result=$i.LastTaskResult;university=$(if ($_.TaskName -eq 'YML Admission Monitor') {$university});phase=$(if ($_.TaskName -eq 'YML Admission Monitor') {$phase})}
} | ConvertTo-Json -Compress
"""
    proc = subprocess.run(["powershell.exe", "-NoProfile", "-Command", script],
                          capture_output=True, timeout=20, creationflags=0x08000000)
    if proc.returncode:
        raise RuntimeError("Windows 예약 작업 조회 실패")
    tasks = json.loads(proc.stdout.decode("utf-8-sig"))
    tasks = tasks if isinstance(tasks, list) else [tasks]
    by_name = {t["name"]: t for t in tasks}
    rows = []
    for name, (title, hours) in TASKS.items():
        task = by_name.get(name, {})
        rows.append(dict(task, name=name, title=title, status=classify(task, hours), details=[], stages=[]))
    quant, admission, ai, drive, futures, review, weekly = rows
    path = DESKTOP / "quant/log.txt"
    content = read_tail(path)
    quant["observedAt"] = observed(path)
    quant["stages"] = [s.strip()[:240] for s in content.splitlines()
                       if re.match(r"^\[(START|RUN|DRIVE|PUBLISH|DEPLOY|END|ERROR)\]", s)
                       or "⮕" in s or "모든 작업 완료" in s or "[OK]" in s][-18:]
    path = latest(ADMISSION / "automation_logs", "*.log")
    admission["observedAt"] = observed(path)
    admission["stages"] = [s[:250] for s in read_tail(path).splitlines()
                           if re.match(r"^\[\d{4}-", s)][-18:]
    receipt = read_json(ADMISSION / "automation_status.json")
    health = read_json(ADMISSION / "new_document_monitor_health.json")
    counts = receipt.get("report", {}).get("counts", {})
    admission["details"] = [
        ["운영 보고 시각", receipt.get("generated_at")],
        ["보고서 검사", receipt.get("report", {}).get("status", "확인 불가")],
        ["완료 기관 / 전체", f'{counts.get("complete_institutions", "?")} / {counts.get("institutions", "?")}'],
        ["보고서 오류", counts.get("errors", "?")],
        ["감시 경고 수", health.get("coverage", {}).get("general_page_attachment_resource_warnings", "?")],
        ["남은 문제", ", ".join(receipt.get("issues", [])) or ("없음" if receipt else "확인 불가")],
        ["검토 대기 분류", json.dumps(receipt.get("human_review", {}).get("counts", {}), ensure_ascii=False)],
    ]
    if receipt.get("issues") and admission["status"] == "최근 실행 성공":
        admission["status"] = "주의 필요"
    admission_signal(admission, receipt, health)
    if admission.get("state") == "Running" and admission.get("university"):
        registry = read_json(ADMISSION.parent / "yonsei_admission_collector/universities.json")
        names = {item["university_id"]: item["official_name"] for item in registry.get("universities", [])}
        school = names.get(admission["university"], admission["university"])
        phase = {"audit": "원본 무결성 검사", "collect": "자료 수집"}.get(admission.get("phase"), "처리 중")
        admission["details"].insert(0, ["현재 세부 단계", f"{school} · {phase}"])
    path = latest(Path(os.environ.get("LOCALAPPDATA", "")) / "PersonalTap/ai-trend", "research-*.log")
    ai["observedAt"] = observed(path)
    ai["stages"] = [s[:240] for s in read_tail(path).splitlines()
                    if s.startswith(("RUN node", "한국어", "Prepared", "Verified", "ERROR", "Error:", "완료"))
                    or "HTTP 403" in s or "operation was aborted" in s][-15:]
    path = DESKTOP / "quant/automation_logs/google-drive-health.log"
    drive["observedAt"] = observed(path)
    drive["details"] = [["Drive 마운트", "연결됨" if Path("G:/내 드라이브").is_dir() else "연결 안 됨"]]
    path = DESKTOP / "남표니/선물거래내역/.futures_automation_state.json"
    futures["observedAt"] = observed(path)
    futures["details"] = [["마지막 분석 기록", observed(path)], ["처리 방식", "새 CSV가 없으면 정상 건너뜀. CSV 다운로드와 포지션은 수동 입력."]]
    for job, mode in ((review, "review"), (weekly, "weekly")):
        path = CHECKS / f"latest-{mode}.json"
        check = read_json(path)
        job["observedAt"] = check.get("updated_at") or observed(path)
        job["details"] = [["현재 단계", check.get("stage", "기록 없음")], *check.get("details", [])]
        if check.get("status") == "running":
            previous = read_json(latest(CHECKS / "history", f"{mode}-*/result.json"))
            if previous:
                check = previous
                job["details"].extend([["검사 기준", "재검사 중 · 직전 완료 결과 유지"], *check.get("details", [])])
        if check.get("error"):
            job["details"].append(["검사 오류", check["error"]])
        if (check.get("status") == "failed" or check.get("pages", {}).get("failed", 0)
                or check.get("review", {}).get("integrity_errors")
                or check.get("review", {}).get("audit_status") == "fail"
                or any(item.get("status") == "fail" for item in check.get("data", {}).get("files", []))):
            job["severity"] = "error"
            job["details"].append(["신호등 판정", "최근 검사에서 오류 발견"])
        if job["status"] == "최근 실행 성공":
            if not check or check.get("status") == "running":
                job["status"] = "확인 불가"
            elif check.get("status") not in {"pass", "healthy"}:
                job["status"] = "주의 필요"
        reasons = []
        if check.get("error"):
            reasons.append("점검 실행 실패")
        if mode == "review":
            value = check.get("review", {})
            if value.get("pending_events"):
                reasons.append(f'자료 검토 대기 {value["pending_events"]}건')
            if value.get("integrity_errors"):
                reasons.append(f'근거 연결 오류 {len(value["integrity_errors"])}건')
        else:
            if check.get("data", {}).get("needs_attention"):
                reasons.append(f'데이터 품질 점검 {check["data"]["needs_attention"]}개')
            if check.get("pages", {}).get("failed"):
                reasons.append(f'페이지 오류 {check["pages"]["failed"]}개')
        if reasons:
            job["reason"] = " · ".join(reasons)
            if job.get("severity") != "error":
                job["severity"] = "warning"
    return {"checkedAt": datetime.now(timezone.utc).isoformat(), "jobs": rows}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def allowed(self):
        return (self.headers.get("Host") in {"127.0.0.1:8768", "localhost:8768"}
                and self.headers.get("Origin") in ORIGINS | {None})

    def send_headers(self, code, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_OPTIONS(self):
        self.send_headers(204 if self.allowed() else 403, "text/plain")

    def do_GET(self):
        if not self.allowed():
            self.send_headers(403, "text/plain")
            return
        route = urlsplit(self.path).path
        reports = {"/admission-review": "admission-review.html", "/weekly-report": "weekly-report.html"}
        if route in reports:
            path = CHECKS / reports[route]
            if not path.is_file():
                self.send_headers(404, "text/plain; charset=utf-8")
                self.wfile.write("점검 기록이 아직 없습니다.".encode())
                return
            self.send_headers(200, "text/html; charset=utf-8")
            self.wfile.write(path.read_bytes())
            return
        if route == "/publication":
            try:
                request = Request("https://personal-tap-data-yuni14.vercel.app/api/ai-trend?status=1", headers={"User-Agent": "PersonalTap-Status/1.0"})
                with urlopen(request, timeout=12) as response:
                    payload = response.read(1000000)
                json.loads(payload)
                self.send_headers(200, "application/json")
                self.wfile.write(payload)
            except Exception:
                self.send_headers(502, "application/json")
                self.wfile.write(b'{"error":"Publication check failed"}')
            return
        if route == "/status":
            try:
                result = status_snapshot()
                self.send_headers(200, "application/json; charset=utf-8")
                self.wfile.write(json.dumps(result, ensure_ascii=False).encode())
            except Exception:
                self.send_headers(503, "application/json")
                self.wfile.write(b'{"error":"Status collection failed"}')
            return
        assets = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/style.css": "style.css", "/health.js": "health.js"}
        if route not in assets:
            self.send_headers(404, "text/plain")
            return
        path = ROOT / "apps/automation-status" / assets[route]
        types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}
        self.send_headers(200, types[path.suffix] + "; charset=utf-8")
        self.wfile.write(path.read_bytes())

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8768), Handler).serve_forever()
