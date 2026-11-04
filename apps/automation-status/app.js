import { signalLevel, overallSignal } from "./health.js?v=traffic-1";
const button = document.querySelector("#refresh");
const localMessage = document.querySelector("#localMessage");
let readings = [];
let checkedAt = 0;
let cloudReadings = [];
let cloudCheckedAt = 0;
function renderSignal() {
  const signal = overallSignal(readings, checkedAt);
  document.querySelector("#healthPanel").dataset.level = signal.level;
  document.querySelector("#healthLabel").textContent = signal.label;
  document.querySelector("#healthReason").textContent = signal.reason;
  document.querySelector("#healthTime").textContent = "마지막 확인: " + (checkedAt ? time(new Date(checkedAt).toISOString()) : "기록 없음")
    + (button.disabled ? " · 조회 중…" : document.hidden ? " · 화면 복귀 시 다시 확인" : " · 30초 자동 갱신");
}
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
function card(target, title, status, details, stages = [], severity) {
  const level = signalLevel(status, severity);
  const node = element("article", undefined, "card");
  node.append(element("h3", title), element("span", status, "badge " + ({red:"bad",yellow:"warning",green:"good"}[level])));
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
  return { title, level };
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
    if (!Array.isArray(data.jobs) || !data.jobs.length || !data.checkedAt) throw new Error("잘못된 응답");
    const age = Date.now() - Date.parse(data.checkedAt);
    if (!Number.isFinite(age) || age < -300000 || age > 90000) throw new Error("PC 확인 기록이 오래됐습니다");
    const signals = data.jobs.map(job => card(target, job.title, job.status, [
      ["마지막 실행", time(job.lastRun)], ["다음 예약", time(job.nextRun)],
      ["Windows 상태 / 종료코드", (job.state || "없음") + " / " + (job.result ?? "없음")],
      ["진행 기록 시각", time(job.observedAt)],
      ...(job.details || []).map(([key, value]) => [key, /시각|분석 기록/.test(key) ? time(value) : translate(value)])
    ], job.stages, job.severity));
    localMessage.textContent = "PC 확인 시각: " + time(data.checkedAt) + " · 실행 성공은 전체 자료의 최신성 보장이 아닙니다.";
    return signals;
  } catch (error) {
    localMessage.textContent = "PC 상태 확인 불가 · " + error.message + ". 이 PC에서 상태 조회 프로그램 실행 여부와 브라우저의 로컬 네트워크 접근 허용을 확인하세요.";
    const link = element("a", "PC 상태 화면 직접 열기");
    link.href = "http://127.0.0.1:8768/"; localMessage.append(" ", link);
    return [{title:"PC 상태 확인 불가",level:"yellow",unavailable:true}];
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
        const serverAge = Date.now() - Date.parse(data.serverNow);
        if (!Number.isFinite(serverAge) || Math.abs(serverAge) > 300000) throw new Error("발행 확인 기록이 오래됐습니다");
        return card(target, "AI Trend 발행", data.delayed ? "발행 지연" : data.entry?.id ? "최신 회차 발행" : "확인 불가", [
          ["서버 확인 시각", time(data.serverNow)], ["현재 발행본", data.entry?.id || "없음"],
          ["준비 완료", time(data.entry?.preparedAt)], ["다음 공개 예정", time(data.nextPublishAt)]
        ]);
      } catch (e) { return {...card(target, "AI Trend 발행", "확인 불가", [["조회 오류", e.message]]), unavailable:true}; }
    })(),
    (async () => {
      try {
        const data = await json("https://api.github.com/repos/Yuni9959/Personal/actions/workflows/daily-briefing.yml/runs?per_page=1", 15000);
        const run = data.workflow_runs?.[0];
        if (!run) throw new Error("실행 기록 없음");
        const runAge = Date.now() - Date.parse(run.created_at);
        const stale = !Number.isFinite(runAge) || runAge < -300000 || runAge > 26 * 3600000;
        const status = run.status === "completed" && run.conclusion !== "success" ? "실패 / 중단"
          : stale ? "실행 기록 오래됨" : run.status !== "completed" ? "실행 중 / 대기" : "최근 실행 성공";
        const signal = card(target, "클라우드 수집 · 주간 기준", status, [
          ["최근 실행", time(run.created_at)], ["처리 결과", run.conclusion || run.status],
          ["범위", "AI 수집과 주간 기준 생성의 합산 결과. 개별 단계는 GitHub 실행 기록에서 확인."]
        ]);
        const link = element("a", "실행 기록 보기");
        link.href = "https://github.com/Yuni9959/Personal/actions/workflows/daily-briefing.yml";
        target.lastElementChild.append(link);
        return signal;
      } catch (e) { return {...card(target, "클라우드 수집 · 주간 기준", "확인 불가", [["조회 오류", e.message]]), unavailable:true}; }
    })()
  ];
  cloudReadings = await Promise.all(checks);
  cloudCheckedAt = Date.now();
  return cloudReadings;
}
async function refresh(automatic = false) {
  if (button.disabled) return;
  button.disabled = true;
  renderSignal();
  document.querySelector("#summary").textContent = "현재 상태 확인 중…";
  try {
    // GitHub's public API is rate limited; automatic cloud checks run every five minutes.
    const results = await Promise.all([local(), automatic && cloudReadings.length && Date.now() - cloudCheckedAt < 300000 ? cloudReadings : cloud()]);
    readings = results.flat();
    checkedAt = Date.now();
    document.querySelector("#summary").textContent = (readings.some(item => item.unavailable) ? "일부 상태 확인 불가" : "조회 완료") + " · " + time(new Date(checkedAt).toISOString());
  } finally { button.disabled = false; renderSignal(); }
}
button.addEventListener("click", () => refresh());
setInterval(() => { renderSignal(); if (!document.hidden) refresh(true); }, 30000);
document.addEventListener("visibilitychange", () => { renderSignal(); if (!document.hidden) refresh(true); });
window.addEventListener("online", () => refresh());
window.addEventListener("offline", () => {
  readings = [...readings.filter(item => item.title !== "네트워크 연결 끊김"), {title:"네트워크 연결 끊김",level:"yellow"}];
  renderSignal();
});
refresh();
