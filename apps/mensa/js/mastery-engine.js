export const MASTERY_SCHEMA_VERSION = 1;

export const MASTERY_LEVELS = Object.freeze([
  { level: 0, status: "new", label: "신규" },
  { level: 1, status: "learning", label: "학습 중" },
  { level: 2, status: "stabilizing", label: "안정화 중" },
  { level: 3, status: "mastered", label: "숙달" },
  { level: 4, status: "maintenance", label: "유지 복습" }
]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_CORRECT_TRANSITIONS = Object.freeze([
  { nextLevel: 1, intervalDays: 3 },
  { nextLevel: 2, intervalDays: 7 },
  { nextLevel: 3, intervalDays: 21 },
  { nextLevel: 4, intervalDays: 45 },
  { nextLevel: 4, intervalDays: 60 }
]);
const WRONG_LEVELS = Object.freeze([0, 0, 1, 2, 2]);

function boundedLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(4, Math.max(0, Math.floor(number)));
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : 0;
}

function validDateKey(value) {
  return typeof value === "string" && DATE_PATTERN.test(value);
}

function dateKeyFromTimestamp(value) {
  const date = new Date(Number(value) || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey, days) {
  if (!validDateKey(dateKey)) {
    throw new Error(`올바르지 않은 날짜 키입니다: ${dateKey}`);
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function masteryDescriptor(level) {
  return MASTERY_LEVELS[boundedLevel(level)];
}

export function blankQuestionProgress(
  questionId,
  contentVersion = null
) {
  return {
    schemaVersion: MASTERY_SCHEMA_VERSION,
    questionId,
    contentVersion,
    level: 0,
    status: "new",
    dueAt: null,

    attempts: 0,
    correct: 0,
    wrong: 0,
    overtime: 0,
    hintUsed: 0,
    validCorrect: 0,
    consecutiveCorrect: 0,
    recoveryAttempts: 0,
    recoverySuccess: 0,

    lastResult: null,
    lastMode: null,
    lastAttemptAt: null,
    lastAttemptDate: null,
    lastElapsedMs: null,
    lastPromotedDate: null,
    lastReviewReason: null,
    updatedAt: null
  };
}

function normalizeProgress(value, questionId, contentVersion) {
  const seed = blankQuestionProgress(questionId, contentVersion);
  if (!value || typeof value !== "object") return seed;

  const level = boundedLevel(value.level);
  return {
    ...seed,
    ...value,
    schemaVersion: MASTERY_SCHEMA_VERSION,
    questionId,
    contentVersion: contentVersion ?? value.contentVersion ?? null,
    level,
    status: masteryDescriptor(level).status,
    attempts: nonNegativeInteger(value.attempts),
    correct: nonNegativeInteger(value.correct),
    wrong: nonNegativeInteger(value.wrong),
    overtime: nonNegativeInteger(value.overtime),
    hintUsed: nonNegativeInteger(value.hintUsed),
    validCorrect: nonNegativeInteger(value.validCorrect),
    consecutiveCorrect: nonNegativeInteger(value.consecutiveCorrect),
    recoveryAttempts: nonNegativeInteger(value.recoveryAttempts),
    recoverySuccess: nonNegativeInteger(value.recoverySuccess)
  };
}

export function applyAttemptToProgress(previous, attempt) {
  if (!attempt?.questionId) {
    throw new Error("숙달 상태를 갱신하려면 questionId가 필요합니다.");
  }

  const progress = normalizeProgress(
    previous,
    attempt.questionId,
    attempt.contentVersion
  );
  if (attempt.skipped) return progress;

  const attemptDate = validDateKey(attempt.localDate)
    ? attempt.localDate
    : dateKeyFromTimestamp(attempt.submittedAt);
  const correct = Boolean(attempt.correct);
  const retry = Boolean(attempt.retry) || attempt.firstPass === false;
  const masteryEligible = Boolean(attempt.eligibleForMastery);
  const isSpeed = attempt.mode === "speed";
  const firstPassMasteryMode =
    !retry &&
    !isSpeed &&
    attempt.firstPass !== false;

  progress.attempts += 1;
  if (correct) progress.correct += 1;
  else progress.wrong += 1;
  if (attempt.overtime) progress.overtime += 1;
  if (attempt.hintUsed) progress.hintUsed += 1;
  if (retry) {
    progress.recoveryAttempts += 1;
    if (correct) progress.recoverySuccess += 1;
  }

  progress.contentVersion = attempt.contentVersion ?? progress.contentVersion;
  progress.lastResult = correct ? "correct" : "wrong";
  progress.lastMode = attempt.mode || null;
  progress.lastAttemptAt = Number(attempt.submittedAt) || null;
  progress.lastAttemptDate = attemptDate;
  progress.lastElapsedMs = Number.isFinite(Number(attempt.elapsedMs))
    ? Math.max(0, Math.round(Number(attempt.elapsedMs)))
    : null;
  progress.updatedAt = progress.lastAttemptAt;

  if (retry) {
    progress.lastReviewReason = correct
      ? "recovery-success"
      : "recovery-wrong";
    return progress;
  }

  // 속도 훈련은 별도 통계이며 일반 숙달 단계를 바꾸지 않는다.
  if (isSpeed) {
    progress.lastReviewReason = "speed-only";
    return progress;
  }

  if (!correct && firstPassMasteryMode) {
    progress.level = WRONG_LEVELS[progress.level];
    progress.status = masteryDescriptor(progress.level).status;
    progress.dueAt = addDays(attemptDate, 1);
    progress.consecutiveCorrect = 0;
    progress.lastReviewReason = "wrong";
    return progress;
  }

  if (correct && masteryEligible) {
    if (progress.lastPromotedDate === attemptDate) {
      progress.lastReviewReason = "same-day-valid-correct";
      return progress;
    }

    const transition = VALID_CORRECT_TRANSITIONS[progress.level];
    progress.level = transition.nextLevel;
    progress.status = masteryDescriptor(progress.level).status;
    progress.dueAt = addDays(attemptDate, transition.intervalDays);
    progress.validCorrect += 1;
    progress.consecutiveCorrect += 1;
    progress.lastPromotedDate = attemptDate;
    progress.lastReviewReason = "valid-correct";
    return progress;
  }

  if (correct && (attempt.overtime || attempt.hintUsed)) {
    progress.dueAt = addDays(attemptDate, 1);
    progress.lastReviewReason = attempt.overtime
      ? "overtime-correct"
      : "hint-correct";
    return progress;
  }

  progress.lastReviewReason = masteryEligible
    ? "non-promoting-attempt"
    : "mastery-ineligible";
  return progress;
}

export function rebuildQuestionProgress(attempts = []) {
  const byQuestionId = new Map();
  const ordered = [...attempts]
    .filter(attempt => attempt?.questionId)
    .sort((left, right) => {
      const timeDifference =
        Number(left.submittedAt || 0) - Number(right.submittedAt || 0);
      if (timeDifference) return timeDifference;
      return String(left.attemptId || "").localeCompare(
        String(right.attemptId || "")
      );
    });

  for (const attempt of ordered) {
    const previous = byQuestionId.get(attempt.questionId);
    byQuestionId.set(
      attempt.questionId,
      applyAttemptToProgress(previous, attempt)
    );
  }

  return byQuestionId;
}

export function isReviewDue(progress, today) {
  return Boolean(
    progress?.dueAt &&
    validDateKey(today) &&
    progress.dueAt <= today
  );
}
