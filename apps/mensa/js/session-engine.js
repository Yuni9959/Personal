import { hashString, shuffled } from "./random.js";

export const SESSION_SCHEMA_VERSION = 2;
export const SHUFFLE_VERSION = 1;

const SESSION_PHASES = new Set(["question", "feedback"]);
const TIMER_STATES = new Set(["running", "paused", "completed"]);

function finiteTimestamp(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : fallback;
}

function sameOrder(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function isPermutation(candidate, expected) {
  return candidate.length === expected.length &&
    new Set(candidate).size === expected.length &&
    candidate.every(value => expected.includes(value));
}

function questionMap(questions) {
  return questions instanceof Map
    ? questions
    : new Map(questions.map(question => [question.id, question]));
}

export function shuffledOptionIds(
  question,
  optionSeed,
  shuffleVersion = SHUFFLE_VERSION
) {
  if (shuffleVersion !== SHUFFLE_VERSION) {
    throw new Error(`지원하지 않는 보기 셔플 버전입니다: ${shuffleVersion}`);
  }

  const original = question.options.map(option => option.id);
  const result = shuffled(original, optionSeed);

  // Fisher-Yates는 드물게 원본 순서를 그대로 만들 수 있다. 세션마다 실제로
  // 위치가 달라져야 하므로 그 경우에만 결정적으로 한 칸 회전한다.
  if (result.length > 1 && sameOrder(result, original)) {
    result.push(result.shift());
  }

  return result;
}

export function createSessionSnapshot({
  sessionId,
  bankVersion,
  mode,
  typeId = null,
  questions,
  previousPresentedOptionIdsByQuestion = null,
  examEndsAt = null,
  now = Date.now()
}) {
  if (!sessionId || !Array.isArray(questions) || !questions.length) {
    throw new Error("세션 ID와 한 개 이상의 문제가 필요합니다.");
  }

  const previousOrders = previousPresentedOptionIdsByQuestion instanceof Map
    ? previousPresentedOptionIdsByQuestion
    : new Map(Object.entries(previousPresentedOptionIdsByQuestion || {}));
  const items = questions.map((question, index) => {
    const optionSeed = hashString(
      `${sessionId}:${question.id}:${index}:options:v${SHUFFLE_VERSION}`
    );
    const presentedOptionIds = shuffledOptionIds(question, optionSeed);
    const previousOrder = previousOrders.get(question.id);
    if (Array.isArray(previousOrder) &&
        presentedOptionIds.length > 1 &&
        sameOrder(presentedOptionIds, previousOrder)) {
      presentedOptionIds.push(presentedOptionIds.shift());
    }
    return {
      questionId: question.id,
      contentVersion: question.contentVersion,
      gradingFingerprint: question.gradingFingerprint || null,
      selectionReason: question.selectionReason || null,
      optionSeed,
      shuffleVersion: SHUFFLE_VERSION,
      presentedOptionIds
    };
  });

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    bankVersion,
    mode,
    typeId,
    status: "active",
    phase: "question",
    items,
    queueQuestionIds: items.map(item => item.questionId),
    currentIndex: 0,
    score: 0,
    answers: [],
    responses: {},
    markedQuestionIds: [],
    hintUsedQuestionIds: [],
    hintLevels: {},
    questionTimers: {},
    pendingSelectionId: null,
    examEndsAt: finiteTimestamp(examEndsAt),
    finalizedAt: null,
    timer: null,
    sessionRevision: 0,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    invalidatedAt: null,
    invalidationReason: null
  };
}

export function inspectSessionCompatibility(
  snapshot,
  questions,
  currentBankVersion
) {
  if (!snapshot || snapshot.schemaVersion !== SESSION_SCHEMA_VERSION) {
    return { compatible: false, reason: "session-schema" };
  }
  if (snapshot.status !== "active") {
    return { compatible: false, reason: "session-status" };
  }
  if (!Array.isArray(snapshot.items) || !snapshot.items.length) {
    return { compatible: false, reason: "session-items" };
  }

  const byId = questionMap(questions);
  const normalizedItems = [];

  for (const item of snapshot.items) {
    const question = byId.get(item?.questionId);
    if (!question) {
      return {
        compatible: false,
        reason: "question-missing",
        questionId: item?.questionId || null
      };
    }
    if (item.gradingFingerprint) {
      if (question.gradingFingerprint !== item.gradingFingerprint) {
        return {
          compatible: false,
          reason: "grading-fingerprint",
          questionId: question.id
        };
      }
    } else if (question.contentVersion !== item.contentVersion) {
      return {
        compatible: false,
        reason: "content-version",
        questionId: question.id
      };
    }

    const expectedOptionIds = question.options.map(option => option.id);
    let presentedOptionIds = Array.isArray(item.presentedOptionIds)
      ? [...item.presentedOptionIds]
      : null;

    if (!presentedOptionIds) {
      try {
        presentedOptionIds = shuffledOptionIds(
          question,
          item.optionSeed,
          item.shuffleVersion
        );
      } catch {
        return {
          compatible: false,
          reason: "shuffle-version",
          questionId: question.id
        };
      }
    }

    if (!isPermutation(presentedOptionIds, expectedOptionIds)) {
      return {
        compatible: false,
        reason: "option-set",
        questionId: question.id
      };
    }

    normalizedItems.push({
      questionId: question.id,
      contentVersion: question.contentVersion,
      gradingFingerprint: question.gradingFingerprint || null,
      selectionReason: item.selectionReason || null,
      optionSeed: nonNegativeInteger(item.optionSeed),
      shuffleVersion: nonNegativeInteger(
        item.shuffleVersion,
        SHUFFLE_VERSION
      ),
      presentedOptionIds
    });
  }

  const currentIndex = nonNegativeInteger(snapshot.currentIndex);
  if (currentIndex >= normalizedItems.length) {
    return { compatible: false, reason: "current-index" };
  }

  return {
    compatible: true,
    reason: null,
    normalizedItems,
    bankVersionChanged: snapshot.bankVersion !== currentBankVersion
  };
}

export function questionClockElapsed(clock, now = Date.now()) {
  if (!clock) return 0;
  const stored = Math.max(0, Number(clock.elapsedMs) || 0);
  if (clock.state !== "running") return stored;

  const runningSince = finiteTimestamp(clock.runningSince, now);
  return stored + Math.max(0, now - runningSince);
}

export function createQuestionClock({
  questionIndex,
  questionId,
  limitMs,
  now = Date.now()
}) {
  return {
    questionIndex,
    questionId,
    limitMs: Math.max(1, nonNegativeInteger(limitMs, 45000)),
    elapsedMs: 0,
    presentedAt: now,
    runningSince: now,
    pausedAt: null,
    completedAt: null,
    state: "running"
  };
}

export function pauseQuestionClock(
  clock,
  {
    now = Date.now(),
    elapsedMs = questionClockElapsed(clock, now)
  } = {}
) {
  if (!clock || clock.state === "completed") return clock;
  return {
    ...clock,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    runningSince: null,
    pausedAt: now,
    state: "paused"
  };
}

export function resumeQuestionClock(clock, now = Date.now()) {
  if (!clock || clock.state === "completed") return clock;
  return {
    ...clock,
    runningSince: now,
    pausedAt: null,
    state: "running"
  };
}

export function completeQuestionClock(
  clock,
  {
    now = Date.now(),
    elapsedMs = questionClockElapsed(clock, now)
  } = {}
) {
  if (!clock) return null;
  return {
    ...clock,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    runningSince: null,
    pausedAt: null,
    completedAt: now,
    state: "completed"
  };
}

function normalizeTimer(timer, currentIndex, now) {
  if (!timer || timer.questionIndex !== currentIndex) return null;
  if (!TIMER_STATES.has(timer.state)) return null;

  const normalized = {
    ...timer,
    elapsedMs: Math.max(0, Number(timer.elapsedMs) || 0),
    limitMs: Math.max(1, nonNegativeInteger(timer.limitMs, 45000)),
    presentedAt: finiteTimestamp(timer.presentedAt, now)
  };

  // 실행 중 브라우저가 종료된 경우 마지막 wall-clock 구간을 반영한 뒤,
  // 홈의 "이어하기" 화면에서는 시간이 더 흐르지 않도록 일시정지한다.
  return normalized.state === "running"
    ? pauseQuestionClock(normalized, { now })
    : normalized;
}

function normalizedStringArray(value, allowed) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .filter(item => typeof item === "string" && allowed.has(item))
  )];
}

function normalizeHintLevels(value, allowed, hintUsedQuestionIds) {
  const levels = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [questionId, rawLevel] of Object.entries(value)) {
      if (!allowed.has(questionId)) continue;
      const level = Math.min(2, nonNegativeInteger(rawLevel));
      if (level > 0) levels[questionId] = level;
    }
  }
  for (const questionId of hintUsedQuestionIds) {
    if (!levels[questionId]) levels[questionId] = 1;
  }
  return levels;
}

function normalizeResponses(value, items) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const itemByQuestionId = new Map(
    items.map(item => [item.questionId, item])
  );
  const responses = {};
  for (const [questionId, response] of Object.entries(value)) {
    const item = itemByQuestionId.get(questionId);
    if (!item || !response || typeof response !== "object") continue;
    const selectedOptionId =
      typeof response.selectedOptionId === "string" &&
      item.presentedOptionIds.includes(response.selectedOptionId)
        ? response.selectedOptionId
        : null;
    responses[questionId] = {
      questionId,
      selectedOptionId,
      attemptId:
        typeof response.attemptId === "string" && response.attemptId
          ? response.attemptId
          : null,
      elapsedMs: Math.max(0, nonNegativeInteger(response.elapsedMs)),
      overtime: Boolean(response.overtime),
      skipped: Boolean(response.skipped) || !selectedOptionId,
      hintUsed: Boolean(response.hintUsed),
      presentedAt: finiteTimestamp(response.presentedAt),
      submittedAt: finiteTimestamp(response.submittedAt)
    };
  }
  return responses;
}

function normalizeQuestionTimers(value, items, currentIndex, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const itemIndexes = new Map(
    items.map((item, index) => [item.questionId, index])
  );
  const timers = {};
  for (const [questionId, timer] of Object.entries(value)) {
    const questionIndex = itemIndexes.get(questionId);
    if (questionIndex == null || !timer || !TIMER_STATES.has(timer.state)) {
      continue;
    }
    const normalized = {
      ...timer,
      questionId,
      questionIndex,
      elapsedMs: Math.max(0, Number(timer.elapsedMs) || 0),
      limitMs: Math.max(1, nonNegativeInteger(timer.limitMs, 45000)),
      presentedAt: finiteTimestamp(timer.presentedAt, now)
    };
    timers[questionId] =
      normalized.state === "running"
        ? pauseQuestionClock(normalized, { now })
        : normalized;
  }

  const currentQuestionId = items[currentIndex]?.questionId;
  if (currentQuestionId && timers[currentQuestionId]) {
    timers[currentQuestionId].questionIndex = currentIndex;
  }
  return timers;
}

export function restoreSessionSnapshot({
  snapshot,
  questions,
  currentBankVersion,
  now = Date.now()
}) {
  const compatibility = inspectSessionCompatibility(
    snapshot,
    questions,
    currentBankVersion
  );
  if (!compatibility.compatible) {
    return { ok: false, compatibility, session: null };
  }

  const byId = questionMap(questions);
  const items = compatibility.normalizedItems;
  const queue = items.map(item => {
    const question = byId.get(item.questionId);
    const options = item.presentedOptionIds.map(optionId =>
      question.options.find(option => option.id === optionId)
    );
    return {
      ...question,
      options,
      selectionReason: item.selectionReason || null
    };
  });
  const answers = Array.isArray(snapshot.answers)
    ? snapshot.answers.map(answer => ({ ...answer }))
    : [];
  const currentIndex = nonNegativeInteger(snapshot.currentIndex);
  const allowedQuestionIds = new Set(items.map(item => item.questionId));
  const responses = normalizeResponses(snapshot.responses, items);
  const questionTimers = normalizeQuestionTimers(
    snapshot.questionTimers,
    items,
    currentIndex,
    now
  );
  const timer = normalizeTimer(snapshot.timer, currentIndex, now);
  if (timer && items[currentIndex]) {
    questionTimers[items[currentIndex].questionId] = timer;
  }
  const pendingSelectionId =
    typeof snapshot.pendingSelectionId === "string" &&
    items[currentIndex]?.presentedOptionIds.includes(
      snapshot.pendingSelectionId
    )
      ? snapshot.pendingSelectionId
      : null;
  const hintUsedQuestionIds = normalizedStringArray(
    snapshot.hintUsedQuestionIds,
    allowedQuestionIds
  );

  return {
    ok: true,
    compatibility,
    session: {
      ...snapshot,
      bankVersion: currentBankVersion,
      items,
      queueQuestionIds: items.map(item => item.questionId),
      queue,
      index: currentIndex,
      currentIndex,
      score: nonNegativeInteger(snapshot.score),
      answers,
      responses,
      markedQuestionIds: normalizedStringArray(
        snapshot.markedQuestionIds,
        allowedQuestionIds
      ),
      hintUsedQuestionIds,
      hintLevels: normalizeHintLevels(
        snapshot.hintLevels,
        allowedQuestionIds,
        hintUsedQuestionIds
      ),
      questionTimers,
      pendingSelectionId,
      examEndsAt: finiteTimestamp(snapshot.examEndsAt),
      finalizedAt: finiteTimestamp(snapshot.finalizedAt),
      phase: SESSION_PHASES.has(snapshot.phase)
        ? snapshot.phase
        : "question",
      timer,
      sessionRevision: nonNegativeInteger(snapshot.sessionRevision),
      locked: snapshot.phase === "feedback",
      speed: snapshot.mode === "speed",
      restored: true
    }
  };
}

export function serializeSession(session) {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: session.sessionId,
    bankVersion: session.bankVersion,
    mode: session.mode,
    typeId: session.typeId ?? null,
    status: session.status,
    phase: SESSION_PHASES.has(session.phase) ? session.phase : "question",
    items: session.items.map(item => ({
      questionId: item.questionId,
      contentVersion: item.contentVersion,
      gradingFingerprint: item.gradingFingerprint || null,
      selectionReason: item.selectionReason || null,
      optionSeed: item.optionSeed,
      shuffleVersion: item.shuffleVersion,
      presentedOptionIds: [...item.presentedOptionIds]
    })),
    queueQuestionIds: session.items.map(item => item.questionId),
    currentIndex: nonNegativeInteger(session.index),
    score: nonNegativeInteger(session.score),
    answers: session.answers.map(answer => ({ ...answer })),
    responses: Object.fromEntries(
      Object.entries(session.responses || {}).map(([questionId, response]) => [
        questionId,
        { ...response }
      ])
    ),
    markedQuestionIds: [...new Set(session.markedQuestionIds || [])],
    hintUsedQuestionIds: [...new Set(session.hintUsedQuestionIds || [])],
    hintLevels: Object.fromEntries(
      Object.entries(session.hintLevels || {})
        .map(([questionId, level]) => [
          questionId,
          Math.min(2, nonNegativeInteger(level))
        ])
        .filter(([, level]) => level > 0)
    ),
    questionTimers: Object.fromEntries(
      Object.entries(session.questionTimers || {}).map(([questionId, timer]) => [
        questionId,
        { ...timer }
      ])
    ),
    pendingSelectionId: session.pendingSelectionId ?? null,
    examEndsAt: finiteTimestamp(session.examEndsAt),
    finalizedAt: finiteTimestamp(session.finalizedAt),
    timer: session.timer ? { ...session.timer } : null,
    sessionRevision: nonNegativeInteger(session.sessionRevision),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt ?? null,
    invalidatedAt: session.invalidatedAt ?? null,
    invalidationReason: session.invalidationReason ?? null
  };
}

export function invalidateSessionSnapshot(
  snapshot,
  reason,
  now = Date.now()
) {
  return {
    ...snapshot,
    status: "invalidated",
    sessionRevision: nonNegativeInteger(snapshot.sessionRevision) + 1,
    updatedAt: now,
    invalidatedAt: now,
    invalidationReason: reason
  };
}
