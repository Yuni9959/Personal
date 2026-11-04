import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import json
from datetime import datetime, timezone, timedelta
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("monitor", Path(__file__).parents[1] / "automation-status-server.py")
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

class StatusTest(unittest.TestCase):
    def test_recheck_keeps_previous_detected_error_until_completion(self):
        tasks = [{"name":"YML Weekly Operations Check", "state":"Running"}]
        def fixture(path):
            if path.name == "latest-weekly.json":
                return {"status":"running", "stage":"재검사 중"}
            if path.name == "result.json":
                return {"status":"attention_required", "pages":{"failed":3}, "details":[]}
            return {}
        with (
            patch.object(monitor.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(tasks).encode())),
            patch.object(monitor, "read_json", side_effect=fixture),
            patch.object(monitor, "latest", return_value=Path("result.json")),
            patch.object(monitor, "read_tail", return_value=""),
        ):
            job = next(j for j in monitor.collect()["jobs"] if j["name"] == "YML Weekly Operations Check")
        self.assertEqual(job["severity"], "error")
        self.assertIn("페이지 오류 3개", job["reason"])

    def test_running_is_healthy_only_with_recent_success_and_progress_within_deadline(self):
        now = datetime.now(timezone.utc).isoformat()
        job = {"state":"Running", "status":"실행 중", "lastRun":now, "observedAt":now}
        receipt = {"status":"healthy", "generated_at":now, "issues":[],
                   "report":{"status":"pass", "counts":{"institutions":26,"complete_institutions":26,"errors":0}}}
        health = {"coverage":{"general_page_attachment_resource_warnings":0}}
        monitor.admission_signal(job, receipt, health)
        self.assertEqual(job["status"], "정상 실행 중")
        for overrides in ({"lastRun":(datetime.now(timezone.utc)-timedelta(hours=3)).isoformat()}, {"observedAt":None}):
            stale = dict(job, status="실행 중", **overrides)
            monitor.admission_signal(stale, receipt, health)
            self.assertEqual(stale["status"], "실행 중")
        job["status"] = "실행 중"
        monitor.admission_signal(job, {}, health)
        self.assertEqual(job["status"], "실행 중")
        receipt["report"]["counts"]["errors"] = 1
        monitor.admission_signal(job, receipt, health)
        self.assertEqual(job["severity"], "error")

    def test_concurrent_screens_share_fresh_snapshot_and_failures_are_not_hidden(self):
        from concurrent.futures import ThreadPoolExecutor
        snapshot = {"checkedAt": datetime.now(timezone.utc).isoformat(), "jobs": []}
        with patch.object(monitor, "STATUS_CACHE", None), patch.object(monitor, "STATUS_CACHE_AT", 0):
            with patch.object(monitor, "collect", return_value=snapshot) as collect:
                with ThreadPoolExecutor(max_workers=3) as pool:
                    values = list(pool.map(lambda _: monitor.status_snapshot(), range(3)))
                self.assertEqual(values, [snapshot] * 3)
                collect.assert_called_once()
            with patch.object(monitor, "STATUS_CACHE_AT", 0), patch.object(monitor, "collect", side_effect=RuntimeError("unavailable")):
                with self.assertRaisesRegex(RuntimeError, "unavailable"):
                    monitor.status_snapshot()

    def test_completed_weekly_checks_keep_detected_problems_visible(self):
        tasks = [{"name": "YML Weekly Operations Check", "state": "Ready", "result": 0,
                  "lastRun": datetime.now(timezone.utc).isoformat()}]
        def fixture(path):
            return {"status": "attention_required", "stage": "점검 완료", "pages": {"failed": 3}, "details": [["페이지 검사", "실패 3개"]]} if path.name == "latest-weekly.json" else {}
        with (
            patch.object(monitor.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(tasks).encode())),
            patch.object(monitor, "read_json", side_effect=fixture),
            patch.object(monitor, "read_tail", return_value=""),
        ):
            result = monitor.collect()
        job = next(j for j in result["jobs"] if j["name"] == "YML Weekly Operations Check")
        self.assertEqual(job["status"], "주의 필요")
        self.assertEqual(job["severity"], "error")
        self.assertIn(["페이지 검사", "실패 3개"], job["details"])

    def test_running_admission_reports_current_school_without_process_arguments(self):
        tasks = [{"name": "YML Admission Monitor", "state": "Running",
                  "university": "ewha_seoul", "phase": "audit"}]
        def fixture(path):
            return {"universities": [{"university_id": "ewha_seoul", "official_name": "이화여자대학교"}]} if path.name == "universities.json" else {}
        with (
            patch.object(monitor.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(tasks).encode(),
            )),
            patch.object(monitor, "read_json", side_effect=fixture),
            patch.object(monitor, "read_tail", return_value=""),
        ):
            result = monitor.collect()
        job = next(j for j in result["jobs"] if j["name"] == "YML Admission Monitor")
        self.assertIn(["현재 세부 단계", "이화여자대학교 · 원본 무결성 검사"], job["details"])
        self.assertNotIn("CommandLine", json.dumps(result))

    def test_states_and_age(self):
        now = datetime.now(timezone.utc)
        task = {"state": "Ready", "lastRun": now.isoformat(), "result": 0}
        self.assertEqual(monitor.classify(task, 1), "최근 실행 성공")
        self.assertEqual(monitor.classify(dict(task, result=1), 1), "실패")
        self.assertEqual(monitor.classify(dict(task, state="Running"), 1), "실행 중")
        self.assertEqual(monitor.classify(dict(task, state="Disabled"), 1), "사용 안 함")
        self.assertEqual(monitor.classify(dict(task, lastRun=(now-timedelta(hours=2)).isoformat()), 1), "오래됨")
        self.assertEqual(monitor.classify({}, 1), "확인 불가")

    def test_no_foreign_host_or_origin(self):
        handler = object.__new__(monitor.Handler)
        handler.headers = {"Host": "127.0.0.1:8768", "Origin": "https://yuni9959.github.io"}
        self.assertTrue(handler.allowed())
        handler.headers["Origin"] = "https://attacker.example"
        self.assertFalse(handler.allowed())
        handler.headers = {"Host": "attacker.example:8768"}
        self.assertFalse(handler.allowed())

if __name__ == "__main__":
    unittest.main()
