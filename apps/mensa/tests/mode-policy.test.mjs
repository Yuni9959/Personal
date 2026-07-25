import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalMode,
  examDurationMs,
  inferOptionLayout,
  modePolicy
} from "../js/mode-policy.js";

test("사용자 모드 5개와 복습 큐의 공개·피드백·제출 정책이 분리된다", () => {
  assert.equal(modePolicy("learn").showQuestionMeta, true);
  assert.equal(modePolicy("learn").allowHint, true);
  assert.equal(modePolicy("daily").showQuestionMeta, false);
  assert.equal(modePolicy("diagnostic").deferredCommit, true);
  assert.equal(modePolicy("diagnostic").feedback, "deferred");
  assert.equal(modePolicy("exam").timer, "hard-session");
  assert.equal(modePolicy("speed").submission, "instant");
  assert.equal(modePolicy("review").feedback, "immediate");
});

test("기존 세션 모드 이름은 새 정책으로 안전하게 복원된다", () => {
  assert.equal(canonicalMode("type"), "learn");
  assert.equal(canonicalMode("mixed25"), "diagnostic");
  assert.equal(canonicalMode("wrong"), "review");
  assert.equal(modePolicy("type").allowHint, true);
});

test("실전 제한시간은 문제별 제한의 85%를 사용하되 10~25분 범위다", () => {
  assert.equal(examDurationMs([{ timeLimitSec: 10 }]), 10 * 60 * 1000);
  assert.equal(
    examDurationMs(Array.from({ length: 25 }, () => ({ timeLimitSec: 60 }))),
    21.25 * 60 * 1000
  );
  assert.equal(
    examDurationMs(Array.from({ length: 100 }, () => ({ timeLimitSec: 60 }))),
    25 * 60 * 1000
  );
});

test("보기 콘텐츠에 따라 grid·compact·list 레이아웃을 자동 선택한다", () => {
  assert.equal(inferOptionLayout({
    options: [{ svg: "<svg></svg>" }, { svg: "<svg></svg>" }]
  }), "grid");
  assert.equal(inferOptionLayout({
    options: [{ text: "12" }, { text: "24" }]
  }), "compact");
  assert.equal(inferOptionLayout({
    options: [
      { text: "조건을 모두 만족하는 긴 문장 보기입니다." },
      { text: "두 번째 긴 문장 보기입니다." }
    ]
  }), "list");
  assert.equal(inferOptionLayout({
    optionLayout: "list",
    options: [{ text: "1" }]
  }), "list");
});
