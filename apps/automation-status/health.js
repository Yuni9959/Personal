export function signalLevel(status, severity) {
  if (severity === "error" || /실패|오류/.test(status || "")) return "red";
  if (severity === "warning") return "yellow";
  return ["최근 실행 성공", "최신 회차 발행"].includes(status) ? "green" : "yellow";
}

export function overallSignal(readings, checkedAt, now = Date.now()) {
  const errors = readings.filter(item => item.level === "red");
  const warnings = readings.filter(item => item.level === "yellow");
  const age = now - checkedAt;
  const stale = !checkedAt || age > 90000 || age < 0;
  if (errors.length) return { level: "red", label: "오류 발생",
    reason: errors.map(item => item.title).join(" · ") + (stale ? " · 확인 기록이 오래됐습니다." : "") };
  if (stale || !readings.length) return { level: "yellow", label: "점검 필요", reason: "최신 상태를 확인해야 합니다." };
  if (warnings.length) return { level: "yellow", label: "점검 필요", reason: warnings.map(item => item.title).join(" · ") };
  return { level: "green", label: "이상 없음", reason: "모든 조회 항목이 정상입니다." };
}
