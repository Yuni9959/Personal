import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyQueue,
  resolveDailyQueue
} from "../js/daily-queue-engine.js";

function questions(count = 30) {
  return Array.from({ length: count }, (_, index) => {
    const typeNumber = index % 10 + 1;
    return {
      id: `T${String(typeNumber).padStart(2, "0")}-${String(
        Math.floor(index / 10) + 1
      ).padStart(2, "0")}`,
      typeId: `T${String(typeNumber).padStart(2, "0")}`,
      contentVersion: 1,
      difficulty: index % 5 + 1,
      options: [{ id: `O-${index}-1` }, { id: `O-${index}-2` }]
    };
  });
}

function abilityAttempt(question, index, correct = true) {
  return {
    attemptId: `attempt-${index}`,
    questionId: question.id,
    contentVersion: question.contentVersion,
    localDate: "2026-07-24",
    submittedAt: 1000 + index,
    correct,
    skipped: false,
    eligibleForAbilityStats: true
  };
}

test("기록이 없는 사용자는 중복 없는 10문제 콜드 스타트 큐를 받는다", () => {
  const queue = buildDailyQueue({
    date: "2026-07-25",
    questions: questions()
  });

  assert.equal(queue.strategy, "cold-start");
  assert.equal(queue.items.length, 10);
  assert.equal(new Set(queue.items.map(item => item.questionId)).size, 10);
  assert.equal(
    queue.items.filter(item => item.reason === "unseen-type").length,
    6
  );
  assert.equal(
    queue.items.filter(item => item.reason === "challenge").length,
    2
  );
  assert.ok(queue.items.every(item => item.contentVersion === 1));
});

test("표본이 충분해진 뒤에는 복습 4·취약 3·신규 2·도전 1 구성을 우선한다", () => {
  const bank = questions(50);
  const attempts = [];
  let attemptIndex = 0;
  for (let typeIndex = 1; typeIndex <= 10; typeIndex += 1) {
    const typeId = `T${String(typeIndex).padStart(2, "0")}`;
    const typeQuestions = bank.filter(question => question.typeId === typeId);
    attempts.push(
      abilityAttempt(typeQuestions[0], attemptIndex++, typeIndex > 3),
      abilityAttempt(typeQuestions[1], attemptIndex++, typeIndex > 3)
    );
  }
  const progress = bank.slice(0, 8).map((question, index) => ({
    questionId: question.id,
    contentVersion: 1,
    level: index % 3,
    dueAt: "2026-07-25"
  }));

  const queue = buildDailyQueue({
    date: "2026-07-25",
    questions: bank,
    attempts,
    questionProgress: progress
  });
  const counts = queue.items.reduce((result, item) => {
    result[item.reason] = (result[item.reason] || 0) + 1;
    return result;
  }, {});

  assert.equal(queue.strategy, "adaptive");
  assert.equal(counts["review-due"], 4);
  assert.equal(counts["weak-type"], 3);
  assert.equal(counts["new-question"], 2);
  assert.equal(counts.challenge, 1);
  assert.equal(new Set(queue.items.map(item => item.questionId)).size, 10);
});

test("표본이 두 번 미만인 유형은 취약 유형으로 분류하지 않는다", () => {
  const bank = questions();
  const attempts = bank.slice(0, 10).map((question, index) =>
    abilityAttempt(question, index, false)
  );
  const queue = buildDailyQueue({
    date: "2026-07-25",
    questions: bank,
    attempts
  });

  assert.equal(queue.strategy, "cold-start");
  assert.equal(
    queue.items.some(item => item.reason === "weak-type"),
    false
  );
});

test("저장된 일일 큐는 통계가 바뀌어도 같은 날 그대로 재사용한다", () => {
  const bank = questions();
  const first = resolveDailyQueue({
    date: "2026-07-25",
    bankVersion: "bank-1",
    questions: bank,
    now: 1000
  });
  const changedAttempts = bank.slice(0, 20).map((question, index) =>
    abilityAttempt(question, index, false)
  );
  const second = resolveDailyQueue({
    date: "2026-07-25",
    bankVersion: "bank-1",
    questions: bank,
    attempts: changedAttempts,
    storedQueue: first.queue,
    now: 2000
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.reused, true);
  assert.deepEqual(second.queue.items, first.queue.items);
  assert.equal(second.queue.updatedAt, first.queue.updatedAt);
});

test("문제 버전이 바뀌면 해당 위치만 교체하고 나머지는 유지한다", () => {
  const bank = questions();
  const first = resolveDailyQueue({
    date: "2026-07-25",
    bankVersion: "bank-1",
    questions: bank,
    now: 1000
  });
  const changedId = first.queue.items[3].questionId;
  const updatedBank = bank.map(question =>
    question.id === changedId
      ? { ...question, contentVersion: 2 }
      : question
  );
  const repaired = resolveDailyQueue({
    date: "2026-07-25",
    bankVersion: "bank-2",
    questions: updatedBank,
    storedQueue: first.queue,
    now: 2000
  });

  assert.equal(repaired.changed, true);
  assert.notEqual(repaired.queue.items[3].questionId, changedId);
  for (const index of [0, 1, 2, 4, 5, 6, 7, 8, 9]) {
    assert.deepEqual(
      repaired.queue.items[index],
      first.queue.items[index]
    );
  }
});
