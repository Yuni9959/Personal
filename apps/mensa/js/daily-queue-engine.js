import { hashString } from "./random.js";
import { isReviewDue } from "./mastery-engine.js";

export const DAILY_QUEUE_STRATEGY_VERSION = 3;
export const DEFAULT_DAILY_QUEUE_SIZE = 10;
export const SUFFICIENT_ABILITY_ATTEMPTS = 20;
export const SUFFICIENT_MEASURED_TYPES = 6;
export const WEAK_TYPE_ACCURACY_THRESHOLD = 0.8;
export const RECENT_DAILY_QUEUE_WINDOW = 6;

function progressMap(questionProgress) {
  if (questionProgress instanceof Map) return new Map(questionProgress);
  return new Map(
    (questionProgress || []).map(progress => [
      progress.questionId,
      progress
    ])
  );
}

function stableRank(value, seedKey) {
  return hashString(`${seedKey}:${value}`);
}

function buildQuestionFacts(questions, attempts, progressById) {
  const questionById = new Map(
    questions.map(question => [question.id, question])
  );
  const attemptCounts = new Map();
  const typeStats = new Map();

  for (const attempt of attempts || []) {
    if (!attempt?.questionId || attempt.skipped) continue;
    const question = questionById.get(attempt.questionId);
    if (!question) continue;

    attemptCounts.set(
      question.id,
      (attemptCounts.get(question.id) || 0) + 1
    );

    const stats = typeStats.get(question.typeId) || {
      typeId: question.typeId,
      attempts: 0,
      samples: 0,
      correct: 0,
      lastAttemptAt: 0,
      recent: []
    };
    stats.attempts += 1;
    stats.lastAttemptAt = Math.max(
      stats.lastAttemptAt,
      Number(attempt.submittedAt || 0)
    );

    if (attempt.eligibleForAbilityStats) {
      stats.samples += 1;
      if (attempt.correct) stats.correct += 1;
      stats.recent.push({
        correct: Boolean(attempt.correct),
        submittedAt: Number(attempt.submittedAt || 0)
      });
      stats.recent.sort(
        (left, right) => right.submittedAt - left.submittedAt
      );
      stats.recent = stats.recent.slice(0, 10);
    }
    typeStats.set(question.typeId, stats);
  }

  for (const question of questions) {
    const progress = progressById.get(question.id);
    const compatibleProgress = progress?.gradingFingerprint
      ? progress.gradingFingerprint === question.gradingFingerprint
      : progress?.contentVersion === question.contentVersion;
    if (progress && !compatibleProgress) {
      progressById.delete(question.id);
    }
  }

  return { questionById, attemptCounts, typeStats };
}

function recentAccuracy(stats) {
  if (!stats?.recent?.length) return null;
  return stats.recent.filter(item => item.correct).length /
    stats.recent.length;
}

function buildTypeCoverage(questions, recentDailyQueues, date) {
  const questionById = new Map(
    questions.map(question => [question.id, question])
  );
  const queueValues = Array.isArray(recentDailyQueues)
    ? recentDailyQueues
    : Object.entries(recentDailyQueues || {}).map(([queueDate, queue]) => ({
        ...queue,
        date: queue?.date || queueDate
      }));
  const queueByDate = new Map();

  for (const queue of queueValues) {
    if (!queue?.date || queue.date >= date || !Array.isArray(queue.items)) {
      continue;
    }
    queueByDate.set(queue.date, queue);
  }

  const history = [...queueByDate.values()].sort(
    (left, right) => left.date.localeCompare(right.date)
  );
  const recentDates = new Set(
    history
      .map(queue => queue.date)
      .sort((left, right) => right.localeCompare(left))
      .slice(0, RECENT_DAILY_QUEUE_WINDOW)
  );
  const coverageByType = new Map();

  for (const queue of history) {
    const queueTypeIds = new Set();
    for (const item of queue.items) {
      const typeId = questionById.get(item?.questionId)?.typeId;
      if (typeId) queueTypeIds.add(typeId);
    }
    for (const typeId of queueTypeIds) {
      const coverage = coverageByType.get(typeId) || {
        typeId,
        queuedDays: 0,
        recentQueuedDays: 0,
        lastQueuedDate: ""
      };
      coverage.queuedDays += 1;
      if (recentDates.has(queue.date)) coverage.recentQueuedDays += 1;
      if (queue.date > coverage.lastQueuedDate) {
        coverage.lastQueuedDate = queue.date;
      }
      coverageByType.set(typeId, coverage);
    }
  }

  return coverageByType;
}

function compareTypeFairness(
  leftTypeId,
  rightTypeId,
  { typeCoverage, typeStats, date, seedKey }
) {
  const leftCoverage = typeCoverage.get(leftTypeId) || {};
  const rightCoverage = typeCoverage.get(rightTypeId) || {};
  const leftStats = typeStats.get(leftTypeId) || {};
  const rightStats = typeStats.get(rightTypeId) || {};

  return Number(leftCoverage.recentQueuedDays || 0) -
      Number(rightCoverage.recentQueuedDays || 0) ||
    String(leftCoverage.lastQueuedDate || "").localeCompare(
      String(rightCoverage.lastQueuedDate || "")
    ) ||
    Number(leftCoverage.queuedDays || 0) -
      Number(rightCoverage.queuedDays || 0) ||
    Number(leftStats.attempts || 0) - Number(rightStats.attempts || 0) ||
    Number(leftStats.lastAttemptAt || 0) -
      Number(rightStats.lastAttemptAt || 0) ||
    stableRank(leftTypeId, `${date}:${seedKey}:type`) -
      stableRank(rightTypeId, `${date}:${seedKey}:type`) ||
    leftTypeId.localeCompare(rightTypeId);
}

function sortQuestionsWithinType(
  questions,
  attemptCounts,
  date,
  seedKey,
  compareQuestions = null
) {
  return [...questions].sort((left, right) => {
    const explicitDifference = compareQuestions
      ? compareQuestions(left, right)
      : 0;
    return explicitDifference ||
      (attemptCounts.get(left.id) || 0) -
        (attemptCounts.get(right.id) || 0) ||
      stableRank(left.id, `${date}:${seedKey}:question`) -
        stableRank(right.id, `${date}:${seedKey}:question`) ||
      left.id.localeCompare(right.id);
  });
}

function sortTypeBalancedQuestions({
  questions,
  attemptCounts,
  typeCoverage,
  typeStats,
  date,
  seedKey,
  compareQuestions = null,
  compareTypes = null
}) {
  const questionsByType = new Map();
  for (const question of questions) {
    const items = questionsByType.get(question.typeId) || [];
    items.push(question);
    questionsByType.set(question.typeId, items);
  }

  const representatives = [...questionsByType.values()].map(items =>
    sortQuestionsWithinType(
      items,
      attemptCounts,
      date,
      seedKey,
      compareQuestions
    )[0]
  );

  return representatives.sort((left, right) => {
    const explicitDifference = compareTypes
      ? compareTypes(left, right)
      : 0;
    return explicitDifference || compareTypeFairness(
      left.typeId,
      right.typeId,
      { typeCoverage, typeStats, date, seedKey }
    );
  });
}

function challengeDifficulty(questions, attempts, questionById) {
  const eligible = (attempts || []).filter(attempt =>
    attempt?.eligibleForAbilityStats &&
    attempt.correct &&
    questionById.has(attempt.questionId)
  );
  if (!eligible.length) return 2;

  const average = eligible.reduce((sum, attempt) => {
    return sum + Number(
      questionById.get(attempt.questionId)?.difficulty || 1
    );
  }, 0) / eligible.length;
  return Math.min(5, Math.max(2, Math.round(average) + 1));
}

function createSelector({
  questions,
  excludedQuestionIds,
  blockedQuestionIds,
  attemptCounts,
  typeCoverage,
  typeStats,
  date,
  targetSize
}) {
  const selected = [];
  const blockedIds = new Set(blockedQuestionIds || []);
  const questionById = new Map(
    questions.map(question => [question.id, question])
  );
  const selectedIds = new Set();
  const selectedTypes = new Set();
  for (const questionId of excludedQuestionIds || []) {
    const question = questionById.get(questionId);
    if (!question || selectedTypes.has(question.typeId)) continue;
    selectedIds.add(question.id);
    selectedTypes.add(question.typeId);
  }
  function add(question, reason) {
    if (!question ||
        blockedIds.has(question.id) ||
        selectedIds.has(question.id) ||
        selectedTypes.has(question.typeId)) {
      return false;
    }
    selected.push({
      questionId: question.id,
      contentVersion: question.contentVersion,
      gradingFingerprint: question.gradingFingerprint || null,
      reason
    });
    selectedIds.add(question.id);
    selectedTypes.add(question.typeId);
    return true;
  }

  function pick(candidates, count, reason) {
    if (count <= 0) return;
    let picked = 0;
    for (const question of candidates) {
      if (selectedIds.size >= targetSize) break;
      if (add(question, reason)) {
        picked += 1;
        if (picked >= count) break;
      }
    }
  }

  function fill(targetSize) {
    const candidates = sortTypeBalancedQuestions({
      questions: questions.filter(question => !blockedIds.has(question.id)),
      attemptCounts,
      typeCoverage,
      typeStats,
      date,
      seedKey: "fill"
    });
    for (const question of candidates) {
      if (selectedIds.size >= targetSize) break;
      add(question, "balanced-fill");
    }
  }

  return {
    selected,
    selectedIds,
    selectedTypes,
    add,
    pick,
    fill
  };
}

function sortDueQuestions({
  questions,
  progressById,
  attemptCounts,
  typeCoverage,
  typeStats,
  date
}) {
  return sortTypeBalancedQuestions({
    questions: questions.filter(
      question => isReviewDue(progressById.get(question.id), date)
    ),
    attemptCounts,
    typeCoverage,
    typeStats,
    date,
    seedKey: "review",
    compareQuestions: (left, right) => {
      const leftProgress = progressById.get(left.id);
      const rightProgress = progressById.get(right.id);
      return leftProgress.dueAt.localeCompare(rightProgress.dueAt) ||
        leftProgress.level - rightProgress.level;
    },
    compareTypes: (left, right) => {
      const leftProgress = progressById.get(left.id);
      const rightProgress = progressById.get(right.id);
      return leftProgress.dueAt.localeCompare(rightProgress.dueAt) ||
        leftProgress.level - rightProgress.level;
    }
  });
}

function pickWeakQuestions({
  questions,
  typeStats,
  typeCoverage,
  attemptCounts,
  selector,
  date,
  count
}) {
  const weakTypes = [...typeStats.values()]
    .filter(stats =>
      stats.samples >= 2 &&
      recentAccuracy(stats) < WEAK_TYPE_ACCURACY_THRESHOLD
    )
    .sort((left, right) => {
      return compareTypeFairness(
        left.typeId,
        right.typeId,
        { typeCoverage, typeStats, date, seedKey: "weak" }
      ) ||
        recentAccuracy(left) - recentAccuracy(right) ||
        right.samples - left.samples;
    });

  let picked = 0;
  for (const stats of weakTypes) {
    if (selector.selectedTypes.has(stats.typeId)) continue;
    const candidates = sortQuestionsWithinType(
      questions.filter(question => question.typeId === stats.typeId),
      attemptCounts,
      date,
      "weak"
    );
    const question = candidates.find(item =>
      !selector.selectedIds.has(item.id)
    );
    if (selector.add(question, "weak-type")) picked += 1;
    if (picked >= count) break;
  }
}

function pickCoverageRefreshQuestions({
  questions,
  typeStats,
  typeCoverage,
  attemptCounts,
  selector,
  date,
  count
}) {
  const practicedTypes = [...typeStats.values()]
    .filter(stats => stats.lastAttemptAt > 0)
    .sort((left, right) => compareTypeFairness(
      left.typeId,
      right.typeId,
      { typeCoverage, typeStats, date, seedKey: "coverage-refresh" }
    )
    );

  let picked = 0;
  for (const stats of practicedTypes) {
    if (selector.selectedTypes.has(stats.typeId)) continue;
    const candidates = sortQuestionsWithinType(
      questions.filter(question => question.typeId === stats.typeId),
      attemptCounts,
      date,
      "coverage-refresh"
    );
    const question = candidates.find(item =>
      !selector.selectedIds.has(item.id)
    );
    if (selector.add(question, "coverage-refresh")) picked += 1;
    if (picked >= count) break;
  }
}

export function buildDailyQueue({
  date,
  questions,
  attempts = [],
  questionProgress = [],
  recentDailyQueues = [],
  targetSize = DEFAULT_DAILY_QUEUE_SIZE,
  excludedQuestionIds = [],
  blockedQuestionIds = []
}) {
  if (!Array.isArray(questions) || questions.length < targetSize) {
    throw new Error("일일 큐를 만들기에 문제 수가 부족합니다.");
  }
  if (new Set(questions.map(question => question.typeId)).size < targetSize) {
    throw new Error("일일 큐를 만들기에 서로 다른 문제 유형이 부족합니다.");
  }

  const progressById = progressMap(questionProgress);
  const {
    questionById,
    attemptCounts,
    typeStats
  } = buildQuestionFacts(
    questions,
    attempts,
    progressById
  );
  const typeCoverage = buildTypeCoverage(
    questions,
    recentDailyQueues,
    date
  );
  const blockedIds = new Set(blockedQuestionIds || []);
  const selectableQuestions = questions.filter(
    question => !blockedIds.has(question.id)
  );
  const selector = createSelector({
    questions,
    excludedQuestionIds,
    blockedQuestionIds,
    attemptCounts,
    typeCoverage,
    typeStats,
    date,
    targetSize
  });
  const dueQuestions = sortDueQuestions({
    questions: selectableQuestions,
    progressById,
    attemptCounts,
    typeCoverage,
    typeStats,
    date
  });
  const measuredTypes = [...typeStats.values()].filter(
    stats => stats.samples >= 2
  ).length;
  const abilityAttempts = [...typeStats.values()].reduce(
    (sum, stats) => sum + stats.samples,
    0
  );
  const sufficientData =
    abilityAttempts >= SUFFICIENT_ABILITY_ATTEMPTS &&
    measuredTypes >= SUFFICIENT_MEASURED_TYPES;

  if (sufficientData) {
    selector.pick(dueQuestions, 4, "review-due");
    pickWeakQuestions({
      questions: selectableQuestions,
      typeStats,
      typeCoverage,
      attemptCounts,
      selector,
      date,
      count: 3
    });
    const newQuestions = sortTypeBalancedQuestions({
      questions: selectableQuestions.filter(question =>
        !progressById.has(question.id) &&
        (attemptCounts.get(question.id) || 0) === 0
      ),
      attemptCounts,
      typeCoverage,
      typeStats,
      date,
      seedKey: "new"
    });
    selector.pick(newQuestions, 2, "new-question");

    const targetDifficulty = challengeDifficulty(
      questions,
      attempts,
      questionById
    );
    const challenges = sortTypeBalancedQuestions({
      questions: selectableQuestions.filter(question =>
        Number(question.difficulty || 1) >= targetDifficulty
      ),
      attemptCounts,
      typeCoverage,
      typeStats,
      date,
      seedKey: "challenge"
    });
    selector.pick(challenges, 1, "challenge");
  } else {
    const reviewTarget = Math.min(2, dueQuestions.length);
    selector.pick(dueQuestions, reviewTarget, "review-due");

    const unseenTarget = Math.max(0, 6 - reviewTarget);
    const attemptedTypes = new Set(
      [...typeStats.values()]
        .filter(stats => stats.lastAttemptAt > 0)
        .map(stats => stats.typeId)
    );
    const unseenQuestions = sortTypeBalancedQuestions({
      questions: selectableQuestions.filter(question =>
        !attemptedTypes.has(question.typeId) &&
        (attemptCounts.get(question.id) || 0) === 0
      ),
      attemptCounts,
      typeCoverage,
      typeStats,
      date,
      seedKey: "unseen-type"
    });
    selector.pick(unseenQuestions, unseenTarget, "unseen-type");

    pickCoverageRefreshQuestions({
      questions: selectableQuestions,
      typeStats,
      typeCoverage,
      attemptCounts,
      selector,
      date,
      count: 2
    });

    const targetDifficulty = challengeDifficulty(
      questions,
      attempts,
      questionById
    );
    const challenges = sortTypeBalancedQuestions({
      questions: selectableQuestions.filter(question =>
        Number(question.difficulty || 1) >= targetDifficulty
      ),
      attemptCounts,
      typeCoverage,
      typeStats,
      date,
      seedKey: "challenge"
    });
    selector.pick(challenges, 2, "challenge");
  }

  selector.fill(targetSize);
  if (selector.selectedIds.size < targetSize) {
    throw new Error("서로 다른 유형만으로 일일 큐를 완성하지 못했습니다.");
  }

  return {
    strategy: sufficientData ? "adaptive" : "cold-start",
    strategyVersion: DAILY_QUEUE_STRATEGY_VERSION,
    targetSize,
    measuredTypes,
    abilityAttempts,
    items: selector.selected.slice(0, targetSize)
  };
}

function validStoredItem(item, questionById, usedIds, usedTypes) {
  const question = questionById.get(item?.questionId);
  const compatibleVersion = item?.gradingFingerprint
    ? question?.gradingFingerprint === item.gradingFingerprint
    : question?.contentVersion === item?.contentVersion;
  if (!question ||
      !compatibleVersion ||
      usedIds.has(question.id) ||
      usedTypes.has(question.typeId)) {
    return false;
  }
  usedIds.add(question.id);
  usedTypes.add(question.typeId);
  return true;
}

export function resolveDailyQueue({
  date,
  bankVersion,
  questions,
  attempts = [],
  questionProgress = [],
  recentDailyQueues = [],
  storedQueue = null,
  targetSize = DEFAULT_DAILY_QUEUE_SIZE,
  now = Date.now()
}) {
  const questionById = new Map(
    questions.map(question => [question.id, question])
  );
  const storedItems = storedQueue?.date === date &&
    Array.isArray(storedQueue.items)
    ? storedQueue.items.slice(0, targetSize)
    : [];
  const usedIds = new Set();
  const usedTypes = new Set();
  const validity = storedItems.map(item =>
    validStoredItem(item, questionById, usedIds, usedTypes)
  );

  if (storedItems.length === targetSize &&
      validity.every(Boolean)) {
    return {
      queue: storedQueue,
      changed: false,
      reused: true
    };
  }

  const keptIds = storedItems
    .filter((item, index) => validity[index])
    .map(item => item.questionId);
  const blockedIds = storedItems
    .filter((item, index) => !validity[index] && questionById.has(
      item?.questionId
    ))
    .map(item => item.questionId);
  const generated = buildDailyQueue({
    date,
    questions,
    attempts,
    questionProgress,
    recentDailyQueues,
    targetSize,
    excludedQuestionIds: keptIds,
    blockedQuestionIds: blockedIds
  });
  const replacements = [...generated.items];
  const items = [];

  for (let index = 0; index < targetSize; index += 1) {
    if (validity[index]) {
      items.push(storedItems[index]);
      continue;
    }
    const replacement = replacements.shift();
    if (!replacement) {
      throw new Error("변경된 일일 큐 항목을 교체하지 못했습니다.");
    }
    items.push({
      ...replacement,
      reason: storedItems[index]
        ? "content-replacement"
        : replacement.reason
    });
  }

  return {
    queue: {
      queueId: storedQueue?.queueId ||
        `daily:${date}:v${DAILY_QUEUE_STRATEGY_VERSION}`,
      date,
      bankVersion,
      strategy: storedQueue?.strategy || generated.strategy,
      strategyVersion: DAILY_QUEUE_STRATEGY_VERSION,
      targetSize,
      items,
      createdAt: storedQueue?.createdAt || now,
      updatedAt: now
    },
    changed: true,
    reused: false
  };
}
