export const STATS_SCHEMA_VERSION = 2;
export const LEGACY_STATS_KEY = "mkat98-stats-v1";
export const SUMMARY_CACHE_KEY = "mkat98-summary-v2";
export const RECOVERY_JOURNAL_KEY = "mkat98-recovery-v2";

export const DEFAULT_SETTINGS = Object.freeze({
  dailyGoal: 10,
  miniGoal: 5
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ABILITY_MODES = new Set(["daily", "mixed25", "diagnostic", "exam"]);

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function validDateKey(value) {
  return typeof value === "string" && DATE_PATTERN.test(value);
}

function dateFromKey(value) {
  return new Date(`${value}T12:00:00`);
}

function questionStatsSeed(value = {}) {
  const attempts = nonNegativeInteger(value.attempts);
  const correct = Math.min(nonNegativeInteger(value.correct), attempts);
  const wrong = Math.min(
    nonNegativeInteger(value.wrong),
    Math.max(0, attempts - correct)
  );

  return {
    attempts,
    correct,
    wrong,
    overtime: Math.min(nonNegativeInteger(value.overtime), attempts),
    lastAnswered: Number.isFinite(Number(value.lastAnswered))
      ? Number(value.lastAnswered)
      : null,
    lastResult: value.lastResult === "correct" || value.lastResult === "wrong"
      ? value.lastResult
      : null
  };
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createRecordId(prefix, cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === "function") {
    return `${prefix}-${cryptoImpl.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function blankLegacyStats() {
  return {
    attempts: 0,
    correct: 0,
    solvedByDate: {},
    questions: {},
    streak: 0,
    lastActiveDate: null
  };
}

export function normalizeLegacyStats(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return blankLegacyStats();
  }

  const attempts = nonNegativeInteger(value.attempts);
  const correct = Math.min(nonNegativeInteger(value.correct), attempts);
  const solvedByDate = {};
  const questions = {};

  if (value.solvedByDate && typeof value.solvedByDate === "object") {
    for (const [date, count] of Object.entries(value.solvedByDate)) {
      const normalizedCount = nonNegativeInteger(count);
      if (validDateKey(date) && normalizedCount > 0) {
        solvedByDate[date] = normalizedCount;
      }
    }
  }

  if (value.questions && typeof value.questions === "object") {
    for (const [questionId, stats] of Object.entries(value.questions)) {
      if (typeof questionId === "string" && questionId) {
        questions[questionId] = questionStatsSeed(stats);
      }
    }
  }

  return {
    attempts,
    correct,
    solvedByDate,
    questions,
    streak: nonNegativeInteger(value.streak),
    lastActiveDate: validDateKey(value.lastActiveDate)
      ? value.lastActiveDate
      : null
  };
}

export function attemptEligibility({
  mode,
  retry = false,
  hintUsed = false,
  overtime = false,
  skipped = false
}) {
  const firstPass = !retry;
  const submitted = !skipped;

  return {
    firstPass,
    retry,
    eligibleForDailyGoal: submitted && firstPass,
    eligibleForMastery:
      submitted && firstPass && !hintUsed && !overtime && mode !== "speed",
    eligibleForAbilityStats:
      submitted && firstPass && !hintUsed && ABILITY_MODES.has(mode),
    eligibleForSpeedStats:
      submitted && firstPass && mode === "speed"
  };
}

export function calculateCurrentStreak(dateKeys, today = localDateKey()) {
  const dates = [...new Set((dateKeys || []).filter(validDateKey))].sort();
  if (!dates.length) return 0;

  const lastDate = dates.at(-1);
  const gapFromToday = Math.round(
    (dateFromKey(today) - dateFromKey(lastDate)) / 86400000
  );
  if (gapFromToday < 0 || gapFromToday > 1) return 0;

  const available = new Set(dates);
  let cursor = lastDate;
  let streak = 0;

  while (available.has(cursor)) {
    streak += 1;
    const previous = dateFromKey(cursor);
    previous.setDate(previous.getDate() - 1);
    cursor = localDateKey(previous);
  }

  return streak;
}

function mergeQuestionStats(target, source) {
  target.attempts += source.attempts;
  target.correct += source.correct;
  target.wrong += source.wrong;
  target.overtime += source.overtime;

  if (source.lastAnswered &&
      (!target.lastAnswered || source.lastAnswered >= target.lastAnswered)) {
    target.lastAnswered = source.lastAnswered;
    target.lastResult = source.lastResult;
  }
}

export function buildStatsSummary({
  attempts = [],
  questionProgress = [],
  legacyStats = blankLegacyStats(),
  settings = DEFAULT_SETTINGS,
  migrationState = {},
  bankVersion = null,
  revision = 0,
  now = new Date()
} = {}) {
  const legacy = normalizeLegacyStats(legacyStats);
  const dailyGoal = Math.max(
    1,
    nonNegativeInteger(settings.dailyGoal) || DEFAULT_SETTINGS.dailyGoal
  );
  const miniGoal = Math.min(
    dailyGoal,
    Math.max(1, nonNegativeInteger(settings.miniGoal) || DEFAULT_SETTINGS.miniGoal)
  );
  const solvedByDate = { ...legacy.solvedByDate };
  const questions = Object.fromEntries(
    Object.entries(legacy.questions).map(([id, stats]) => [
      id,
      questionStatsSeed(stats)
    ])
  );
  const practiceDates = new Set(Object.keys(solvedByDate));
  const goalQuestionIds = new Map();

  let v2Attempts = 0;
  let v2Correct = 0;
  let v2Overtime = 0;
  let firstPassAttempts = 0;
  let firstPassCorrect = 0;
  let abilityAttempts = 0;
  let abilityCorrect = 0;
  let speedAttempts = 0;
  let speedCorrect = 0;

  const orderedAttempts = [...attempts].sort(
    (left, right) => Number(left.submittedAt || 0) - Number(right.submittedAt || 0)
  );

  for (const attempt of orderedAttempts) {
    if (!attempt || attempt.skipped || !attempt.questionId) continue;

    const submittedAt = Number(attempt.submittedAt || 0);
    const date = validDateKey(attempt.localDate)
      ? attempt.localDate
      : localDateKey(new Date(submittedAt || now));
    const correct = Boolean(attempt.correct);

    v2Attempts += 1;
    if (correct) v2Correct += 1;
    if (attempt.overtime) v2Overtime += 1;
    if (attempt.firstPass) {
      firstPassAttempts += 1;
      if (correct) firstPassCorrect += 1;
    }
    if (attempt.eligibleForAbilityStats) {
      abilityAttempts += 1;
      if (correct) abilityCorrect += 1;
    }
    if (attempt.eligibleForSpeedStats) {
      speedAttempts += 1;
      if (correct) speedCorrect += 1;
    }

    solvedByDate[date] = (solvedByDate[date] || 0) + 1;
    practiceDates.add(date);

    const aggregate = questions[attempt.questionId] || questionStatsSeed();
    mergeQuestionStats(aggregate, {
      attempts: 1,
      correct: correct ? 1 : 0,
      wrong: correct ? 0 : 1,
      overtime: attempt.overtime ? 1 : 0,
      lastAnswered: submittedAt || null,
      lastResult: correct ? "correct" : "wrong"
    });
    questions[attempt.questionId] = aggregate;

    if (attempt.eligibleForDailyGoal) {
      const ids = goalQuestionIds.get(date) || new Set();
      ids.add(attempt.questionId);
      goalQuestionIds.set(date, ids);
    }
  }

  const goalCompletedDates = [...goalQuestionIds.entries()]
    .filter(([, ids]) => ids.size >= dailyGoal)
    .map(([date]) => date)
    .sort();
  const practiceDays = [...practiceDates].sort();
  const todayKey = localDateKey(now);
  const todayGoalProgress = goalQuestionIds.get(todayKey)?.size || 0;
  const completionStreak = calculateCurrentStreak(goalCompletedDates, todayKey);
  const practiceStreak = calculateCurrentStreak(practiceDays, todayKey);
  const totalAttempts = legacy.attempts + v2Attempts;
  const totalCorrect = legacy.correct + v2Correct;
  const masteryByLevel = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  let reviewDue = 0;
  let mastered = 0;
  let nextDueAt = null;

  for (const progress of questionProgress) {
    const level = Math.min(
      4,
      Math.max(0, Math.floor(Number(progress?.level) || 0))
    );
    masteryByLevel[level] += 1;
    if (level >= 3) mastered += 1;
    if (typeof progress?.dueAt === "string") {
      if (progress.dueAt <= todayKey) reviewDue += 1;
      if (!nextDueAt || progress.dueAt < nextDueAt) {
        nextDueAt = progress.dueAt;
      }
    }
  }

  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    revision: nonNegativeInteger(revision),
    generatedAt: now.getTime(),
    bankVersion,

    attempts: totalAttempts,
    correct: totalCorrect,
    solvedByDate,
    questions,

    streak: completionStreak,
    completionStreak,
    practiceStreak,
    practiceDays,

    today: {
      localDate: todayKey,
      solvedAttempts: solvedByDate[todayKey] || 0,
      goalProgress: todayGoalProgress,
      goalTarget: dailyGoal,
      goalCompleted: todayGoalProgress >= dailyGoal
    },

    goals: {
      dailyTarget: dailyGoal,
      miniTarget: miniGoal,
      completedDates: goalCompletedDates,
      lastCompletedDate: goalCompletedDates.at(-1) || null
    },

    v2: {
      attempts: v2Attempts,
      correct: v2Correct,
      overtime: v2Overtime,
      firstPassAttempts,
      firstPassCorrect,
      abilityAttempts,
      abilityCorrect,
      speedAttempts,
      speedCorrect
    },

    mastery: {
      tracked: questionProgress.length,
      mastered,
      reviewDue,
      nextDueAt,
      byLevel: masteryByLevel
    },

    legacy: {
      imported: Boolean(migrationState.sourceFound),
      attempts: legacy.attempts,
      correct: legacy.correct,
      practiceDays: Object.keys(legacy.solvedByDate).sort(),
      legacyStreak: legacy.streak,
      lastActiveDate: legacy.lastActiveDate,
      officialGoalCompletionsImported: false
    },

    migration: {
      completedAt: migrationState.completedAt || null,
      noticePending:
        Boolean(migrationState.sourceFound) &&
        !migrationState.noticeDismissedAt
    }
  };
}
