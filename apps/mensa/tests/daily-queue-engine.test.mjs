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
      gradingFingerprint: `fingerprint-${index}`,
      difficulty: index % 5 + 1,
      options: [{ id: `O-${index}-1` }, { id: `O-${index}-2` }]
    };
  });
}

function balancedQuestions(typeCount = 59, questionsPerType = 5) {
  const items = [];
  for (let typeIndex = 1; typeIndex <= typeCount; typeIndex += 1) {
    const typeId = `T${String(typeIndex).padStart(2, "0")}`;
    for (let questionIndex = 1;
      questionIndex <= questionsPerType;
      questionIndex += 1) {
      const index = items.length;
      items.push({
        id: `${typeId}-${String(questionIndex).padStart(2, "0")}`,
        typeId,
        contentVersion: 1,
        gradingFingerprint: `balanced-fingerprint-${index}`,
        difficulty: questionIndex,
        options: [{ id: `B-${index}-1` }, { id: `B-${index}-2` }]
      });
    }
  }
  return items;
}

function unevenQuestions() {
  const items = [];
  for (let typeIndex = 1; typeIndex <= 59; typeIndex += 1) {
    const typeId = `T${String(typeIndex).padStart(2, "0")}`;
    const questionCount = typeIndex <= 24 ? 27 : 10;
    for (let questionIndex = 1;
      questionIndex <= questionCount;
      questionIndex += 1) {
      const index = items.length;
      items.push({
        id: `${typeId}-${String(questionIndex).padStart(2, "0")}`,
        typeId,
        contentVersion: 1,
        gradingFingerprint: `uneven-fingerprint-${index}`,
        difficulty: (questionIndex - 1) % 5 + 1,
        options: [{ id: `U-${index}-1` }, { id: `U-${index}-2` }]
      });
    }
  }
  return items;
}

function dateAfter(start, offset) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function typeIdsForQueue(queue, questionById) {
  return queue.items.map(item => questionById.get(item.questionId).typeId);
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
  const questionById = new Map(
    questions().map(question => [question.id, question])
  );
  assert.equal(
    new Set(queue.items.map(item =>
      questionById.get(item.questionId).typeId
    )).size,
    10
  );
  assert.equal(
    queue.items.filter(item => item.reason === "unseen-type").length,
    6
  );
  assert.equal(
    queue.items.filter(item => item.reason === "challenge").length,
    2
  );
  assert.ok(queue.items.every(item => item.contentVersion === 1));
  assert.ok(queue.items.every(item => item.gradingFingerprint));
});

test("표본이 충분해진 뒤에는 복습 4·취약 3·신규 2·도전 1 구성을 우선한다", () => {
  const bank = balancedQuestions(10, 5);
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
  const dueTypeIds = new Set(["T07", "T08", "T09", "T10"]);
  const progress = [...dueTypeIds].map((typeId, index) => {
    const question = bank.find(item => item.typeId === typeId);
    return {
      questionId: question.id,
      contentVersion: 1,
      level: index % 3,
      dueAt: "2026-07-25"
    };
  });

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
  const questionById = new Map(
    bank.map(question => [question.id, question])
  );
  assert.equal(
    new Set(queue.items.map(item =>
      questionById.get(item.questionId).typeId
    )).size,
    10
  );
});

test("복습 예정 문제가 한 유형에 몰려도 오늘의 큐에는 그 유형을 한 번만 넣는다", () => {
  const bank = questions();
  const sameType = bank.filter(question => question.typeId === "T01");
  const progress = sameType.map(question => ({
    questionId: question.id,
    contentVersion: question.contentVersion,
    gradingFingerprint: question.gradingFingerprint,
    level: 1,
    dueAt: "2026-07-25"
  }));
  const queue = buildDailyQueue({
    date: "2026-07-25",
    questions: bank,
    questionProgress: progress
  });
  const questionById = new Map(
    bank.map(question => [question.id, question])
  );
  const selectedTypes = queue.items.map(item =>
    questionById.get(item.questionId).typeId
  );

  assert.equal(
    queue.items.filter(item => item.reason === "review-due").length,
    1
  );
  assert.equal(new Set(selectedTypes).size, 10);
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

test("모두 맞힌 유형은 표본이 많아도 취약 유형으로 다시 뽑지 않는다", () => {
  const bank = questions(50);
  const attempts = bank.slice(0, 20).map((question, index) =>
    abilityAttempt(question, index, true)
  );
  const queue = buildDailyQueue({
    date: "2026-07-25",
    questions: bank,
    attempts
  });

  assert.equal(queue.strategy, "adaptive");
  assert.equal(
    queue.items.some(item => item.reason === "weak-type"),
    false
  );
});

test("취약 유형도 전날 나온 유형보다 덜 노출된 유형을 먼저 순환한다", () => {
  const bank = balancedQuestions(10, 5);
  const questionById = new Map(bank.map(question => [question.id, question]));
  const attempts = [];
  let attemptIndex = 0;
  for (let typeIndex = 1; typeIndex <= 10; typeIndex += 1) {
    const typeId = `T${String(typeIndex).padStart(2, "0")}`;
    const typeQuestions = bank.filter(question => question.typeId === typeId);
    attempts.push(
      abilityAttempt(typeQuestions[0], attemptIndex++, typeIndex > 6),
      abilityAttempt(typeQuestions[1], attemptIndex++, typeIndex > 6)
    );
  }
  const previousItems = ["T01", "T02", "T03"].map(typeId => {
    const question = bank.find(item => item.typeId === typeId);
    return {
      questionId: question.id,
      contentVersion: question.contentVersion,
      gradingFingerprint: question.gradingFingerprint,
      reason: "weak-type"
    };
  });
  const queue = buildDailyQueue({
    date: "2026-07-25",
    questions: bank,
    attempts,
    recentDailyQueues: [{ date: "2026-07-24", items: previousItems }]
  });
  const weakTypeIds = queue.items
    .filter(item => item.reason === "weak-type")
    .map(item => questionById.get(item.questionId).typeId)
    .sort();

  assert.deepEqual(weakTypeIds, ["T04", "T05", "T06"]);
});

test("풀이 기록이 없어도 최근 큐 이력으로 6일 안에 59개 유형을 순환한다", () => {
  const bank = unevenQuestions();
  const questionById = new Map(bank.map(question => [question.id, question]));
  const recentDailyQueues = [];
  const selectedTypes = [];
  let previousTypes = [];

  for (let day = 0; day < 6; day += 1) {
    const date = dateAfter("2026-08-01", day);
    const queue = buildDailyQueue({
      date,
      questions: bank,
      recentDailyQueues
    });
    const types = typeIdsForQueue(queue, questionById);
    if (previousTypes.length) {
      assert.equal(
        types.filter(typeId => previousTypes.includes(typeId)).length,
        0
      );
    }
    selectedTypes.push(...types);
    recentDailyQueues.push({ date, items: queue.items });
    previousTypes = types;
  }

  assert.equal(new Set(selectedTypes).size, 59);
  const counts = selectedTypes.reduce((result, typeId) => {
    result.set(typeId, (result.get(typeId) || 0) + 1);
    return result;
  }, new Map());
  assert.equal(Math.max(...counts.values()), 2);
});

test("30일 연속 정답에서도 유형 노출 횟수와 전날 중복이 제한된다", () => {
  const bank = unevenQuestions();
  const questionById = new Map(bank.map(question => [question.id, question]));
  const recentDailyQueues = [];
  const attempts = [];
  const typeCounts = new Map();
  let attemptIndex = 0;
  let previousTypes = [];

  for (let day = 0; day < 30; day += 1) {
    const date = dateAfter("2026-08-01", day);
    const queue = buildDailyQueue({
      date,
      questions: bank,
      attempts,
      recentDailyQueues
    });
    const types = typeIdsForQueue(queue, questionById);
    assert.ok(
      types.filter(typeId => previousTypes.includes(typeId)).length <= 2
    );
    assert.equal(
      queue.items.some(item => item.reason === "weak-type"),
      false
    );
    for (const typeId of types) {
      typeCounts.set(typeId, (typeCounts.get(typeId) || 0) + 1);
    }
    queue.items.forEach(item => {
      attempts.push(abilityAttempt(
        questionById.get(item.questionId),
        attemptIndex++,
        true
      ));
    });
    recentDailyQueues.push({ date, items: queue.items });
    previousTypes = types;
  }

  assert.equal(typeCounts.size, 59);
  assert.ok(
    Math.max(...typeCounts.values()) - Math.min(...typeCounts.values()) <= 2
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

test("채점 fingerprint가 같으면 문구 버전이 바뀌어도 일일 큐를 유지한다", () => {
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
  const reused = resolveDailyQueue({
    date: "2026-07-25",
    bankVersion: "bank-2",
    questions: updatedBank,
    storedQueue: first.queue,
    now: 2000
  });

  assert.equal(reused.changed, false);
  assert.equal(reused.reused, true);
  assert.deepEqual(reused.queue.items, first.queue.items);
});

test("저장된 큐에 같은 유형이 두 번 있으면 중복 위치만 다른 유형으로 고친다", () => {
  const bank = questions();
  const first = resolveDailyQueue({
    date: "2026-07-25",
    bankVersion: "bank-1",
    questions: bank,
    now: 1000
  });
  const questionById = new Map(
    bank.map(question => [question.id, question])
  );
  const firstType = questionById.get(
    first.queue.items[0].questionId
  ).typeId;
  const duplicateTypeQuestion = bank.find(question =>
    question.typeId === firstType &&
    question.id !== first.queue.items[0].questionId
  );
  const corruptedQueue = {
    ...first.queue,
    strategyVersion: 1,
    items: first.queue.items.map((item, index) =>
      index === 1
        ? {
            questionId: duplicateTypeQuestion.id,
            contentVersion: duplicateTypeQuestion.contentVersion,
            gradingFingerprint: duplicateTypeQuestion.gradingFingerprint,
            reason: "legacy-duplicate"
          }
        : item
    )
  };
  const repaired = resolveDailyQueue({
    date: "2026-07-25",
    bankVersion: "bank-2",
    questions: bank,
    storedQueue: corruptedQueue,
    now: 2000
  });
  const selectedTypes = repaired.queue.items.map(item =>
    questionById.get(item.questionId).typeId
  );

  assert.equal(repaired.changed, true);
  assert.equal(repaired.reused, false);
  assert.deepEqual(repaired.queue.items[0], corruptedQueue.items[0]);
  assert.notEqual(
    repaired.queue.items[1].questionId,
    duplicateTypeQuestion.id
  );
  assert.equal(new Set(selectedTypes).size, 10);
  assert.equal(repaired.queue.strategyVersion, 3);
});

test("채점 fingerprint가 바뀌면 해당 위치만 교체하고 나머지는 유지한다", () => {
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
      ? {
          ...question,
          contentVersion: 2,
          gradingFingerprint: `${question.gradingFingerprint}-changed`
        }
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
