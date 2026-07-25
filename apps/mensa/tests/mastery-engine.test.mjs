import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  applyAttemptToProgress,
  blankQuestionProgress,
  isReviewDue,
  rebuildQuestionProgress
} from "../js/mastery-engine.js";

function attempt(overrides = {}) {
  return {
    attemptId: "attempt-1",
    sessionId: "session-1",
    questionId: "T01-01",
    contentVersion: 1,
    mode: "daily",
    localDate: "2026-07-25",
    correct: true,
    firstPass: true,
    retry: false,
    hintUsed: false,
    elapsedMs: 1200,
    overtime: false,
    skipped: false,
    eligibleForMastery: true,
    submittedAt: Date.parse("2026-07-25T12:00:00"),
    ...overrides
  };
}

test("유효 정답은 서로 다른 날에 3회 성공하면 숙달 단계가 된다", () => {
  let progress = blankQuestionProgress("T01-01", 1);
  progress = applyAttemptToProgress(progress, attempt({
    attemptId: "a1",
    localDate: "2026-07-01"
  }));
  assert.equal(progress.level, 1);
  assert.equal(progress.dueAt, "2026-07-04");

  progress = applyAttemptToProgress(progress, attempt({
    attemptId: "a2",
    localDate: "2026-07-04"
  }));
  assert.equal(progress.level, 2);
  assert.equal(progress.dueAt, "2026-07-11");

  progress = applyAttemptToProgress(progress, attempt({
    attemptId: "a3",
    localDate: "2026-07-11"
  }));
  assert.equal(progress.level, 3);
  assert.equal(progress.status, "mastered");
  assert.equal(progress.dueAt, "2026-08-01");
  assert.equal(progress.validCorrect, 3);
  assert.equal(progress.consecutiveCorrect, 3);
});

test("같은 날 반복한 유효 정답은 숙달 단계를 다시 올리지 않는다", () => {
  const first = applyAttemptToProgress(
    null,
    attempt({ attemptId: "a1" })
  );
  const repeated = applyAttemptToProgress(
    first,
    attempt({ attemptId: "a2", submittedAt: first.lastAttemptAt + 1000 })
  );

  assert.equal(repeated.level, 1);
  assert.equal(repeated.validCorrect, 1);
  assert.equal(repeated.dueAt, "2026-07-28");
  assert.equal(repeated.lastReviewReason, "same-day-valid-correct");
});

test("오답은 단계별 강등 규칙을 적용하고 다음 날 복습시킨다", () => {
  for (const [level, expected] of [[0, 0], [1, 0], [2, 1], [3, 2], [4, 2]]) {
    const result = applyAttemptToProgress(
      {
        ...blankQuestionProgress("T01-01", 1),
        level,
        consecutiveCorrect: 4
      },
      attempt({
        correct: false,
        localDate: "2026-07-25"
      })
    );
    assert.equal(result.level, expected);
    assert.equal(result.dueAt, "2026-07-26");
    assert.equal(result.consecutiveCorrect, 0);
  }
});

test("제한시간을 넘긴 첫 오답도 정답 승급 자격과 무관하게 강등한다", () => {
  const result = applyAttemptToProgress(
    {
      ...blankQuestionProgress("T01-01", 1),
      level: 3,
      status: "mastered"
    },
    attempt({
      correct: false,
      overtime: true,
      eligibleForMastery: false
    })
  );

  assert.equal(result.level, 2);
  assert.equal(result.dueAt, "2026-07-26");
  assert.equal(result.lastReviewReason, "wrong");
});

test("숙달과 유지 복습의 유효 정답 간격은 각각 45일과 60일이다", () => {
  const mastered = applyAttemptToProgress(
    {
      ...blankQuestionProgress("T01-01", 1),
      level: 3,
      status: "mastered",
      lastPromotedDate: "2026-06-01"
    },
    attempt({ localDate: "2026-07-01" })
  );
  assert.equal(mastered.level, 4);
  assert.equal(mastered.dueAt, addDays("2026-07-01", 45));

  const maintained = applyAttemptToProgress(
    mastered,
    attempt({
      attemptId: "a2",
      localDate: "2026-08-15"
    })
  );
  assert.equal(maintained.level, 4);
  assert.equal(maintained.dueAt, addDays("2026-08-15", 60));
});

test("시간초과·힌트 정답은 승급하지 않고 다음 날 다시 복습한다", () => {
  const overtime = applyAttemptToProgress(
    null,
    attempt({
      overtime: true,
      eligibleForMastery: false
    })
  );
  assert.equal(overtime.level, 0);
  assert.equal(overtime.dueAt, "2026-07-26");
  assert.equal(overtime.lastReviewReason, "overtime-correct");

  const hinted = applyAttemptToProgress(
    overtime,
    attempt({
      attemptId: "a2",
      localDate: "2026-07-26",
      hintUsed: true,
      eligibleForMastery: false
    })
  );
  assert.equal(hinted.level, 0);
  assert.equal(hinted.dueAt, "2026-07-27");
  assert.equal(hinted.lastReviewReason, "hint-correct");
});

test("즉시 재도전 정답은 recoverySuccess만 기록하고 단계를 바꾸지 않는다", () => {
  const afterWrong = applyAttemptToProgress(
    { ...blankQuestionProgress("T01-01", 1), level: 2 },
    attempt({ correct: false })
  );
  const recovered = applyAttemptToProgress(
    afterWrong,
    attempt({
      attemptId: "retry-1",
      correct: true,
      firstPass: false,
      retry: true,
      eligibleForMastery: false,
      submittedAt: afterWrong.lastAttemptAt + 1000
    })
  );

  assert.equal(recovered.level, 1);
  assert.equal(recovered.dueAt, "2026-07-26");
  assert.equal(recovered.recoveryAttempts, 1);
  assert.equal(recovered.recoverySuccess, 1);
  assert.equal(recovered.lastReviewReason, "recovery-success");
});

test("속도 훈련은 일반 숙달 단계와 복습일을 바꾸지 않는다", () => {
  const previous = {
    ...blankQuestionProgress("T01-01", 1),
    level: 3,
    status: "mastered",
    dueAt: "2026-08-01"
  };
  const result = applyAttemptToProgress(
    previous,
    attempt({
      mode: "speed",
      correct: false,
      eligibleForMastery: false
    })
  );

  assert.equal(result.level, 3);
  assert.equal(result.dueAt, "2026-08-01");
  assert.equal(result.lastReviewReason, "speed-only");
});

test("응시 순서가 뒤섞여 있어도 시간순으로 동일한 진행 상태를 재생성한다", () => {
  const attempts = [
    attempt({
      attemptId: "a2",
      localDate: "2026-07-04",
      submittedAt: Date.parse("2026-07-04T12:00:00")
    }),
    attempt({
      attemptId: "a1",
      localDate: "2026-07-01",
      submittedAt: Date.parse("2026-07-01T12:00:00")
    })
  ];
  const rebuilt = rebuildQuestionProgress(attempts).get("T01-01");

  assert.equal(rebuilt.level, 2);
  assert.equal(rebuilt.validCorrect, 2);
  assert.equal(isReviewDue(rebuilt, "2026-07-11"), true);
  assert.equal(isReviewDue(rebuilt, "2026-07-10"), false);
});
