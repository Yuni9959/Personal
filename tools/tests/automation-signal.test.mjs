import test from "node:test";
import assert from "node:assert/strict";
import { signalLevel, overallSignal } from "../../apps/automation-status/health.js";

test("자동화 신호등은 전체 정상일 때만 초록, 미확인·진행 중은 노랑, 오류는 빨강이다", () => {
  assert.equal(signalLevel("최근 실행 성공"), "green");
  assert.equal(signalLevel("최신 회차 발행"), "green");
  assert.equal(signalLevel("정상 실행 중"), "green");
  assert.equal(signalLevel("정상 실행 중", "error"), "red");
  for (const status of ["확인 불가","실행 중","오래됨","사용 안 함","주의 필요",undefined]) {
    assert.equal(signalLevel(status), "yellow");
  }
  assert.equal(signalLevel("실패"), "red");
  assert.equal(signalLevel("주의 필요", "error"), "red");
  assert.equal(overallSignal([{title:"정상",level:"green"}], 1000, 1001).level, "green");
  assert.equal(overallSignal([], 1000, 1001).level, "yellow");
  assert.equal(overallSignal([{title:"정상",level:"green"}], 1000, 92000).level, "yellow");
  const mixed = [{title:"미확인",level:"yellow"}, {title:"페이지 오류",level:"red"}];
  assert.equal(overallSignal(mixed, 1000, 1001).level, "red");
  assert.match(overallSignal(mixed, 1000, 1001).reason, /페이지 오류/);
  assert.match(overallSignal([{title:"주간 검사",level:"yellow",reason:"데이터 품질 점검 3개"}], 1000, 1001).reason, /데이터 품질 점검 3개/);
  assert.equal(overallSignal(mixed, 1000, 92000).level, "red");
});
