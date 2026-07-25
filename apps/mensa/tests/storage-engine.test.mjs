import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_STATS_KEY,
  RECOVERY_JOURNAL_KEY,
  SUMMARY_CACHE_KEY,
  attemptEligibility,
  buildStatsSummary,
  normalizeLegacyStats
} from "../js/stats-model.js";
import {
  MemoryTrainingRepository,
  TrainingStore
} from "../js/training-store.js";

class MemoryLocalStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.failSetKeys = new Set();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failSetKeys.has(key)) {
      throw new Error(`setItem failure: ${key}`);
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class FailingAttemptRepository extends MemoryTrainingRepository {
  constructor() {
    super();
    this.failAttempts = 0;
  }

  async commitAttempt(payload) {
    if (this.failAttempts > 0) {
      this.failAttempts -= 1;
      throw new Error("simulated IndexedDB transaction failure");
    }
    return super.commitAttempt(payload);
  }
}

function makeAttempt(overrides = {}) {
  return {
    attemptId: "attempt-1",
    sessionId: "session-1",
    questionId: "T01-01",
    contentVersion: 1,
    bankVersion: "test-bank",
    mode: "daily",
    localDate: "2026-07-25",
    selectedOptionId: "T01-01-O1",
    presentedOptionIds: [
      "T01-01-O1",
      "T01-01-O2",
      "T01-01-O3",
      "T01-01-O4",
      "T01-01-O5",
      "T01-01-O6"
    ],
    correct: false,
    firstPass: true,
    retry: false,
    hintUsed: false,
    elapsedMs: 1200,
    overtime: false,
    skipped: false,
    inferredErrorTag: null,
    presentedAt: 1000,
    submittedAt: 2200,
    eligibleForDailyGoal: true,
    eligibleForMastery: true,
    eligibleForAbilityStats: true,
    eligibleForSpeedStats: false,
    ...overrides
  };
}

function makeSession(overrides = {}) {
  return {
    sessionId: "session-1",
    bankVersion: "test-bank",
    mode: "daily",
    typeId: null,
    status: "active",
    queueQuestionIds: ["T01-01"],
    currentIndex: 0,
    score: 0,
    answerCount: 1,
    startedAt: 1000,
    updatedAt: 2200,
    completedAt: null,
    ...overrides
  };
}

test("v1 기록은 연습일과 원문 통계만 보존하고 목표 완주일로 만들지 않는다", () => {
  const legacy = normalizeLegacyStats({
    attempts: 12,
    correct: 8,
    solvedByDate: {
      "2026-07-23": 1,
      "2026-07-24": 10
    },
    questions: {
      "T01-01": {
        attempts: 2,
        correct: 1,
        wrong: 1,
        overtime: 0,
        lastAnswered: 100
      }
    },
    streak: 99,
    lastActiveDate: "2026-07-24"
  });

  const summary = buildStatsSummary({
    legacyStats: legacy,
    migrationState: { sourceFound: true, completedAt: 200 },
    bankVersion: "test-bank",
    now: new Date("2026-07-25T12:00:00")
  });

  assert.equal(summary.attempts, 12);
  assert.equal(summary.correct, 8);
  assert.deepEqual(summary.practiceDays, ["2026-07-23", "2026-07-24"]);
  assert.deepEqual(summary.goals.completedDates, []);
  assert.equal(summary.completionStreak, 0);
  assert.equal(summary.today.goalProgress, 0);
  assert.equal(summary.legacy.legacyStreak, 99);
  assert.equal(summary.legacy.officialGoalCompletionsImported, false);
});

test("일일 목표는 v2의 서로 다른 유효 문제만 세고 연속 완주일을 계산한다", () => {
  const attempts = [];
  for (const date of ["2026-07-24", "2026-07-25"]) {
    for (let index = 1; index <= 10; index += 1) {
      attempts.push(makeAttempt({
        attemptId: `${date}-${index}`,
        questionId: `T01-${String(index).padStart(2, "0")}`,
        localDate: date,
        submittedAt: Date.parse(`${date}T12:00:00`) + index
      }));
    }
  }
  attempts.push(makeAttempt({
    attemptId: "retry-duplicate",
    questionId: "T01-01",
    localDate: "2026-07-25",
    firstPass: false,
    retry: true,
    eligibleForDailyGoal: false,
    submittedAt: Date.parse("2026-07-25T13:00:00")
  }));

  const summary = buildStatsSummary({
    attempts,
    bankVersion: "test-bank",
    now: new Date("2026-07-25T14:00:00")
  });

  assert.deepEqual(summary.goals.completedDates, [
    "2026-07-24",
    "2026-07-25"
  ]);
  assert.equal(summary.completionStreak, 2);
  assert.equal(summary.today.goalProgress, 10);
  assert.equal(summary.today.goalCompleted, true);
  assert.equal(summary.v2.attempts, 21);
  assert.equal(summary.v2.firstPassAttempts, 20);
});

test("모드 정책에 따라 목표·숙달·능력·속도 통계 자격을 분리한다", () => {
  assert.deepEqual(attemptEligibility({ mode: "daily" }), {
    firstPass: true,
    retry: false,
    eligibleForDailyGoal: true,
    eligibleForMastery: true,
    eligibleForAbilityStats: true,
    eligibleForSpeedStats: false
  });

  assert.equal(
    attemptEligibility({ mode: "type", hintUsed: true })
      .eligibleForMastery,
    false
  );
  assert.equal(
    attemptEligibility({ mode: "speed" }).eligibleForSpeedStats,
    true
  );
  assert.equal(
    attemptEligibility({ mode: "retry", retry: true })
      .eligibleForDailyGoal,
    false
  );
});

test("v1 이전은 한 번만 실행되고 원본과 legacyStreak를 meta에 백업한다", async () => {
  const legacy = {
    attempts: 3,
    correct: 2,
    solvedByDate: { "2026-07-24": 3 },
    questions: {},
    streak: 17,
    lastActiveDate: "2026-07-24"
  };
  const localStorage = new MemoryLocalStorage({
    [LEGACY_STATS_KEY]: JSON.stringify(legacy),
    [SUMMARY_CACHE_KEY]: "{broken"
  });
  const repository = new MemoryTrainingRepository();
  const store = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:00:00")
  });

  const summary = await store.initialize({ bankVersion: "test-bank" });
  const backup = await repository.getMeta("legacyBackup");

  assert.equal(summary.legacy.imported, true);
  assert.equal(summary.legacy.legacyStreak, 17);
  assert.equal(backup.raw, JSON.stringify(legacy));
  assert.equal(JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY)).schemaVersion, 2);

  localStorage.setItem(LEGACY_STATS_KEY, JSON.stringify({
    ...legacy,
    attempts: 999
  }));
  const secondStore = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:05:00")
  });
  const secondSummary = await secondStore.initialize({
    bankVersion: "test-bank-2"
  });
  assert.equal(secondSummary.legacy.attempts, 3);
  assert.deepEqual(await repository.getMeta("bankMetadata"), {
    bankVersion: "test-bank-2",
    previousBankVersion: "test-bank",
    updatedAt: Date.parse("2026-07-25T12:05:00")
  });
});

test("응시 저장 실패 시 복구 저널에 보관하고 다음 시작에서 중복 없이 복원한다", async () => {
  const localStorage = new MemoryLocalStorage();
  const repository = new FailingAttemptRepository();
  const firstStore = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:00:00")
  });
  await firstStore.initialize({ bankVersion: "test-bank" });

  repository.failAttempts = 1;
  const result = await firstStore.recordAttempt(
    makeAttempt(),
    makeSession()
  );

  assert.equal(result.saved, false);
  assert.equal(result.queuedForRecovery, true);
  assert.equal((await repository.getAll("attempts")).length, 0);
  assert.equal(
    JSON.parse(localStorage.getItem(RECOVERY_JOURNAL_KEY)).entries.length,
    1
  );
  assert.equal(result.summary.v2.attempts, 1);

  const recoveredStore = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:10:00")
  });
  const recoveredSummary = await recoveredStore.initialize({
    bankVersion: "test-bank"
  });

  assert.equal((await repository.getAll("attempts")).length, 1);
  assert.equal(localStorage.getItem(RECOVERY_JOURNAL_KEY), null);
  assert.equal(recoveredSummary.v2.attempts, 1);
  assert.equal(recoveredSummary.revision, 1);
});

test("IndexedDB와 복구 저널이 함께 실패해도 메모리 복구 항목을 잃지 않는다", async () => {
  const localStorage = new MemoryLocalStorage();
  const repository = new FailingAttemptRepository();
  const store = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:00:00")
  });
  await store.initialize({ bankVersion: "test-bank" });

  repository.failAttempts = 2;
  localStorage.failSetKeys.add(RECOVERY_JOURNAL_KEY);
  const failed = await store.recordAttempt(makeAttempt(), makeSession());

  assert.equal(failed.storage.recoveryPending, 1);
  assert.equal((await store.exportData()).recoveryEntries.length, 1);

  await store.flushRecovery();
  assert.equal(store.storageSnapshot().recoveryPending, 1);
  assert.equal((await store.exportData()).recoveryEntries.length, 1);
  assert.equal((await repository.getAll("attempts")).length, 0);

  localStorage.failSetKeys.delete(RECOVERY_JOURNAL_KEY);
  await store.flushRecovery();
  assert.equal(store.storageSnapshot().recoveryPending, 0);
  assert.equal((await repository.getAll("attempts")).length, 1);
  assert.equal(localStorage.getItem(RECOVERY_JOURNAL_KEY), null);
});

test("요약 캐시 쓰기 실패는 IndexedDB 응시 트랜잭션을 되돌리지 않는다", async () => {
  const localStorage = new MemoryLocalStorage();
  const repository = new MemoryTrainingRepository();
  const store = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:00:00")
  });
  await store.initialize({ bankVersion: "test-bank" });

  localStorage.failSetKeys.add(SUMMARY_CACHE_KEY);
  const result = await store.recordAttempt(makeAttempt(), makeSession());

  assert.equal(result.saved, true);
  assert.equal((await repository.getAll("attempts")).length, 1);
  assert.equal(result.storage.cacheAvailable, false);

  localStorage.failSetKeys.delete(SUMMARY_CACHE_KEY);
  const rebuiltStore = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:10:00")
  });
  const rebuilt = await rebuiltStore.initialize({
    bankVersion: "test-bank"
  });
  assert.equal(rebuilt.v2.attempts, 1);
  assert.equal(JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY)).v2.attempts, 1);
});

test("데이터 내보내기는 네 저장소와 요약·버전 정보를 함께 보존한다", async () => {
  const localStorage = new MemoryLocalStorage();
  const repository = new MemoryTrainingRepository();
  const store = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:00:00")
  });
  await store.initialize({ bankVersion: "test-bank" });
  await store.recordAttempt(makeAttempt(), makeSession());

  const exported = await store.exportData();

  assert.equal(exported.exportSchemaVersion, 1);
  assert.equal(exported.statsSchemaVersion, 2);
  assert.equal(exported.databaseName, "mkat98-training-v2");
  assert.equal(exported.bankVersion, "test-bank");
  assert.equal(exported.summary.v2.attempts, 1);
  assert.deepEqual(Object.keys(exported.data).sort(), [
    "attempts",
    "meta",
    "questionProgress",
    "sessions"
  ]);
  assert.equal(exported.data.attempts.length, 1);
  assert.equal(exported.data.sessions.length, 1);
  assert.ok(exported.data.meta.some(record => record.key === "legacyBackup"));
});

test("기록 초기화 후에는 남아 있던 v1 통계를 다시 가져오지 않는다", async () => {
  const localStorage = new MemoryLocalStorage({
    [LEGACY_STATS_KEY]: JSON.stringify({
      attempts: 10,
      correct: 5,
      solvedByDate: { "2026-07-24": 10 },
      streak: 4
    })
  });
  const repository = new MemoryTrainingRepository();
  const store = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:00:00")
  });
  await store.initialize({ bankVersion: "test-bank" });
  const resetSummary = await store.reset();

  assert.equal(resetSummary.attempts, 0);
  assert.equal(resetSummary.legacy.imported, false);
  assert.equal(localStorage.getItem(LEGACY_STATS_KEY), null);
  assert.equal((await repository.getAll("attempts")).length, 0);
  assert.equal((await repository.getAll("sessions")).length, 0);

  const reopened = new TrainingStore({
    repository,
    localStorageImpl: localStorage,
    now: () => Date.parse("2026-07-25T12:10:00")
  });
  const reopenedSummary = await reopened.initialize({
    bankVersion: "test-bank"
  });
  assert.equal(reopenedSummary.attempts, 0);
  assert.equal(reopenedSummary.goals.completedDates.length, 0);
});
