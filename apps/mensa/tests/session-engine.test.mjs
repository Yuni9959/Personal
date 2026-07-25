import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_SCHEMA_VERSION,
  SHUFFLE_VERSION,
  completeQuestionClock,
  createQuestionClock,
  createSessionSnapshot,
  inspectSessionCompatibility,
  pauseQuestionClock,
  questionClockElapsed,
  restoreSessionSnapshot,
  resumeQuestionClock,
  serializeSession,
  shuffledOptionIds
} from "../js/session-engine.js";

function question(overrides = {}) {
  return {
    id: "T01-01",
    contentVersion: 1,
    correctOptionId: "T01-01-O2",
    gradingFingerprint: "fingerprint-1",
    timeLimitSec: 45,
    options: [
      { id: "T01-01-O1", text: "1" },
      { id: "T01-01-O2", text: "2" },
      { id: "T01-01-O3", text: "3" },
      { id: "T01-01-O4", text: "4" }
    ],
    ...overrides
  };
}

test("세션 생성 시 모든 보기 ID를 실제로 섞고 재현 정보를 저장한다", () => {
  const source = question();
  const snapshot = createSessionSnapshot({
    sessionId: "session-a",
    bankVersion: "bank-1",
    mode: "daily",
    questions: [source],
    now: 1000
  });
  const item = snapshot.items[0];
  const original = source.options.map(option => option.id);

  assert.equal(snapshot.schemaVersion, SESSION_SCHEMA_VERSION);
  assert.equal(item.shuffleVersion, SHUFFLE_VERSION);
  assert.notDeepEqual(item.presentedOptionIds, original);
  assert.deepEqual(
    [...item.presentedOptionIds].sort(),
    [...original].sort()
  );
  assert.deepEqual(
    shuffledOptionIds(source, item.optionSeed, item.shuffleVersion),
    item.presentedOptionIds
  );
});

test("즉시 재도전은 새 seed가 같은 순열을 만들더라도 이전 보기 순서를 반복하지 않는다", () => {
  const source = question();
  const first = createSessionSnapshot({
    sessionId: "session-a",
    bankVersion: "bank-1",
    mode: "daily",
    questions: [source]
  });
  const previous = first.items[0].presentedOptionIds;
  const retry = createSessionSnapshot({
    sessionId: "session-a",
    bankVersion: "bank-1",
    mode: "retry",
    questions: [source],
    previousPresentedOptionIdsByQuestion: new Map([
      [source.id, previous]
    ])
  });

  assert.notDeepEqual(retry.items[0].presentedOptionIds, previous);
  assert.deepEqual(
    [...retry.items[0].presentedOptionIds].sort(),
    [...previous].sort()
  );
});

test("실제 표시 순서가 있으면 seed보다 그 순서를 우선해 복원한다", () => {
  const source = question();
  const snapshot = createSessionSnapshot({
    sessionId: "session-a",
    bankVersion: "bank-1",
    mode: "daily",
    questions: [source],
    now: 1000
  });
  snapshot.items[0].optionSeed = 0;

  const restored = restoreSessionSnapshot({
    snapshot,
    questions: [source],
    currentBankVersion: "bank-1",
    now: 2000
  });

  assert.equal(restored.ok, true);
  assert.deepEqual(
    restored.session.queue[0].options.map(option => option.id),
    snapshot.items[0].presentedOptionIds
  );
  assert.deepEqual(
    serializeSession(restored.session).items[0].presentedOptionIds,
    snapshot.items[0].presentedOptionIds
  );
});

test("bankVersion만 달라지고 문항 contentVersion이 같으면 복원할 수 있다", () => {
  const source = question();
  const snapshot = createSessionSnapshot({
    sessionId: "session-a",
    bankVersion: "bank-1",
    mode: "daily",
    questions: [source]
  });
  const result = inspectSessionCompatibility(
    snapshot,
    [source],
    "bank-2"
  );

  assert.equal(result.compatible, true);
  assert.equal(result.bankVersionChanged, true);
});

test("문항·버전·보기 집합이 바뀐 세션은 조용히 복원하지 않는다", () => {
  const source = question();
  const snapshot = createSessionSnapshot({
    sessionId: "session-a",
    bankVersion: "bank-1",
    mode: "daily",
    questions: [source]
  });

  assert.equal(
    inspectSessionCompatibility(snapshot, [], "bank-1").reason,
    "question-missing"
  );
  assert.equal(
    inspectSessionCompatibility(
      snapshot,
      [question({ contentVersion: 2 })],
      "bank-2"
    ).reason,
    "content-version"
  );
  assert.equal(
    inspectSessionCompatibility(
      snapshot,
      [question({ gradingFingerprint: "fingerprint-2" })],
      "bank-2"
    ).reason,
    "grading-fingerprint"
  );

  snapshot.items[0].presentedOptionIds[0] = "missing-option";
  assert.equal(
    inspectSessionCompatibility(snapshot, [source], "bank-1").reason,
    "option-set"
  );
});

test("문제 시계는 실행·일시정지·재개·완료 시간을 일관되게 계산한다", () => {
  const created = createQuestionClock({
    questionIndex: 0,
    questionId: "T01-01",
    limitMs: 45000,
    now: 1000
  });
  assert.equal(questionClockElapsed(created, 2500), 1500);

  const paused = pauseQuestionClock(created, { now: 2500 });
  assert.equal(paused.elapsedMs, 1500);
  assert.equal(questionClockElapsed(paused, 9000), 1500);

  const resumed = resumeQuestionClock(paused, 10000);
  assert.equal(questionClockElapsed(resumed, 12500), 4000);

  const completed = completeQuestionClock(resumed, { now: 12500 });
  assert.equal(completed.elapsedMs, 4000);
  assert.equal(completed.state, "completed");
  assert.equal(questionClockElapsed(completed, 20000), 4000);
});

test("복원 대기 화면에서는 종료 중 흐른 시간을 반영한 뒤 시계를 멈춘다", () => {
  const source = question();
  const snapshot = createSessionSnapshot({
    sessionId: "session-a",
    bankVersion: "bank-1",
    mode: "daily",
    questions: [source],
    now: 1000
  });
  snapshot.timer = createQuestionClock({
    questionIndex: 0,
    questionId: source.id,
    limitMs: 45000,
    now: 2000
  });

  const restored = restoreSessionSnapshot({
    snapshot,
    questions: [source],
    currentBankVersion: "bank-1",
    now: 5000
  });

  assert.equal(restored.ok, true);
  assert.equal(restored.session.timer.state, "paused");
  assert.equal(restored.session.timer.elapsedMs, 3000);
});

test("평가 모드의 임시 답안·표시·문제별 시간·종료 시각을 복원한다", () => {
  const first = question();
  const second = question({
    id: "T02-01",
    correctOptionId: "T02-01-O3",
    gradingFingerprint: "fingerprint-2",
    options: [
      { id: "T02-01-O1", text: "1" },
      { id: "T02-01-O2", text: "2" },
      { id: "T02-01-O3", text: "3" },
      { id: "T02-01-O4", text: "4" }
    ]
  });
  const snapshot = createSessionSnapshot({
    sessionId: "session-exam",
    bankVersion: "bank-1",
    mode: "exam",
    questions: [first, second],
    examEndsAt: 900000,
    now: 1000
  });
  snapshot.currentIndex = 1;
  snapshot.responses[first.id] = {
    questionId: first.id,
    selectedOptionId: snapshot.items[0].presentedOptionIds[0],
    elapsedMs: 3500,
    overtime: false,
    skipped: false,
    hintUsed: false,
    presentedAt: 1000,
    submittedAt: 5000
  };
  snapshot.markedQuestionIds = [first.id, "missing"];
  snapshot.hintUsedQuestionIds = [first.id];
  snapshot.questionTimers[first.id] = {
    ...createQuestionClock({
      questionIndex: 0,
      questionId: first.id,
      limitMs: 45000,
      now: 1000
    }),
    elapsedMs: 3500,
    runningSince: null,
    pausedAt: 5000,
    state: "paused"
  };
  snapshot.pendingSelectionId =
    snapshot.items[1].presentedOptionIds[1];

  const restored = restoreSessionSnapshot({
    snapshot,
    questions: [first, second],
    currentBankVersion: "bank-1",
    now: 6000
  });
  const serialized = serializeSession(restored.session);

  assert.equal(restored.ok, true);
  assert.equal(
    restored.session.responses[first.id].selectedOptionId,
    snapshot.responses[first.id].selectedOptionId
  );
  assert.deepEqual(restored.session.markedQuestionIds, [first.id]);
  assert.deepEqual(restored.session.hintUsedQuestionIds, [first.id]);
  assert.equal(
    restored.session.questionTimers[first.id].elapsedMs,
    3500
  );
  assert.equal(
    restored.session.pendingSelectionId,
    snapshot.pendingSelectionId
  );
  assert.equal(restored.session.examEndsAt, 900000);
  assert.deepEqual(serialized.responses, restored.session.responses);
  assert.deepEqual(
    serialized.questionTimers,
    restored.session.questionTimers
  );
});

test("복원할 때 현재 보기 목록에 없는 임시 선택은 버린다", () => {
  const source = question();
  const snapshot = createSessionSnapshot({
    sessionId: "session-diagnostic",
    bankVersion: "bank-1",
    mode: "diagnostic",
    questions: [source],
    now: 1000
  });
  snapshot.pendingSelectionId = "removed-option";
  snapshot.responses[source.id] = {
    questionId: source.id,
    selectedOptionId: "removed-option",
    elapsedMs: 100,
    skipped: false
  };

  const restored = restoreSessionSnapshot({
    snapshot,
    questions: [source],
    currentBankVersion: "bank-1",
    now: 2000
  });

  assert.equal(restored.session.pendingSelectionId, null);
  assert.equal(
    restored.session.responses[source.id].selectedOptionId,
    null
  );
  assert.equal(restored.session.responses[source.id].skipped, true);
});
