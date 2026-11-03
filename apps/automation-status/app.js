const button = document.querySelector("#refresh");
const localMessage = document.querySelector("#localMessage");
function translate(value) {
  if (typeof value !== "string") return value;
  const labels = {monitor_degraded:"감시 경고 있음",pt_sync_pending:"Personal Tap 게시 연동 대기",
    automatic_recovery_required:"자동 복구 대기",fact_approved:"검증 승인 완료",
    not_standing_policy_candidate:"자동 처리 대상 외",source_admitted:"출처 편입 완료",pass:"통과"};
  return value.replace(/\b[a-z_]+\b/g, word => labels[word] || word);
}
const time = value => {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isFinite(+date) ? date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) + " KST" : String(value);
};
function element(tag, value, cls) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}
function card(target, title, status, details, stages = []) {
  const node = element("article", undefined, "card");
  node.append(element("h3", title), element("span", status, "badge " + (/실패|지연|오래됨|주의|불가/.test(status) ? "bad" : /성공|최신/.test(status) ? "good" : /실행/.test(status) ? "running" : "")));
  const list = element("dl");
  details.forEach(([key, value]) => { list.append(element("dt", key), element("dd", value ?? "기록 없음")); });
  node.append(list);
  if (stages.length) {
    const section = element("details");
    section.append(element("summary", "최근 진행 기록 · " + stages.length + "개"));
    const lines = element("ol");
    stages.forEach(s => lines.append(element("li", s)));
    section.append(lines); node.append(section);
  }
  target.append(node);
}
async function json(url, timeout = 25000) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}
async function local() {
  const target = document.querySelector("#jobs");
  target.replaceChildren();
  localMessage.textContent = "Windows 예약 작업과 최신 기록을 읽는 중…";
  try {
    const data = await json("http://127.0.0.1:8768/status");
    if (!Array.isArray(data.jobs) || !data.checkedAt) throw new Error("잘못된 응답");
    data.jobs.forEach(job => card(target, job.title, job.status, [
      ["마지막 실행", time(job.lastRun)], ["다음 예약", time(job.nextRun)],
      ["Windows 상태 / 종료코드", (job.state || "없음") + " / " + (job.result ?? "없음")],
      ["진행 기록 시각", time(job.observedAt)],
      ...(job.details || []).map(([key, value]) => [key, /시각|분석 기록/.test(key) ? time(value) : translate(value)])
    ], job.stages));
    localMessage.textContent = "PC 확인 시각: " + time(data.checkedAt) + " · 실행 성공은 전체 자료의 최신성 보장이 아닙니다.";
    return true;
  } catch (error) {
    localMessage.textContent = "PC 상태 확인 불가 · " + error.message + ". 이 PC에서 상태 조회 프로그램 실행 여부와 브라우저의 로컬 네트워크 접근 허용을 확인하세요.";
    const link = element("a", "PC 상태 화면 직접 열기");
    link.href = "http://127.0.0.1:8768/"; localMessage.append(" ", link);
    return false;
  }
}
async function cloud() {
  const target = document.querySelector("#cloud");
  target.replaceChildren();
  const checks = [
    (async () => {
      try {
        const endpoint = ["127.0.0.1", "localhost"].includes(location.hostname) && location.port === "8768"
          ? "/publication" : "https://personal-tap-data-yuni14.vercel.app/api/ai-trend?status=1";
        const data = await json(endpoint, 15000);
        if (typeof data.delayed !== "boolean" || !data.serverNow) throw new Error("잘못된 발행 응답");
        card(target, "AI Trend 발행", data.delayed ? "발행 지연" : "최신 회차 발행", [
          ["서버 확인 시각", time(data.serverNow)], ["현재 발행본", data.entry?.id || "없음"],
          ["준비 완료", time(data.entry?.preparedAt)], ["다음 공개 예정", time(data.nextPublishAt)]
        ]);
        return true;
      } catch (e) { card(target, "AI Trend 발행", "확인 불가", [["조회 오류", e.message]]); return false; }
    })(),
    (async () => {
      try {
        const data = await json("https://api.github.com/repos/Yuni9959/Personal/actions/workflows/daily-briefing.yml/runs?per_page=1", 15000);
        const run = data.workflow_runs?.[0];
        if (!run) throw new Error("실행 기록 없음");
        const stale = Date.now() - Date.parse(run.created_at) > 26 * 3600000;
        card(target, "클라우드 수집 · 주간 기준", stale ? "실행 기록 오래됨" : run.status !== "completed" ? "실행 중 / 대기" : run.conclusion === "success" ? "최근 실행 성공" : "실패 / 중단", [
          ["최근 실행", time(run.created_at)], ["처리 결과", run.conclusion || run.status],
          ["범위", "AI 수집과 주간 기준 생성의 합산 결과. 개별 단계는 GitHub 실행 기록에서 확인."]
        ]);
        const link = element("a", "실행 기록 보기");
        link.href = "https://github.com/Yuni9959/Personal/actions/workflows/daily-briefing.yml";
        target.lastElementChild.append(link);
        return true;
      } catch (e) { card(target, "클라우드 수집 · 주간 기준", "확인 불가", [["조회 오류", e.message]]); return false; }
    })()
  ];
  return (await Promise.all(checks)).every(Boolean);
}
async function refresh() {
  if (button.disabled) return;
  button.disabled = true;
  document.querySelector("#summary").textContent = "현재 상태 확인 중…";
  try {
    const results = await Promise.all([local(), cloud()]);
    document.querySelector("#summary").textContent = (results.every(Boolean) ? "조회 완료" : "일부 상태 확인 불가") + " · " + time(new Date().toISOString());
  } finally { button.disabled = false; }
}
button.addEventListener("click", refresh);
refresh();
