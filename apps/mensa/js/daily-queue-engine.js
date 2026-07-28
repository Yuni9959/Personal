import { hashString } from "./random.js";
import { isReviewDue } from "./mastery-engine.js";

export const DAILY_QUEUE_STRATEGY_VERSION = 2;
export const DEFAULT_DAILY_QUEUE_SIZE = 10;
export const SUFFICIENT_ABILITY_ATTEMPTS = 20;
export const SUFFICIENT_MEASURED_TYPES = 6;

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

function sortStable(items, seedKey, id = item => item.id) {
  return [...items].sort((left, right) => {
    const rankDifference =
      stableRank(id(left), seedKey) - stableRank(id(right), seedKey);
    return rankDifference || id(left).localeCompare(id(right));
  });
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
      samples: 0,
      correct: 0,
      lastAttemptAt: 0,
      recent: []
    };
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
  const selectedTypeCounts = new Map(
    [...selectedTypes].map(typeId => [typeId, 1])
  );

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
    selectedTypeCounts.set(
      question.typeId,
      (selectedTypeCounts.get(question.typeId) || 0) + 1
    );
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
    const candidates = [...questions].sort((left, right) => {
      const typeDifference =
        (selectedTypeCounts.get(left.typeId) || 0) -
        (selectedTypeCounts.get(right.typeId) || 0);
      if (typeDifference) return typeDifference;
      const attemptDifference =
        (attemptCounts.get(left.id) || 0) -
        (attemptCounts.get(right.id) || 0);
      if (attemptDifference) return attemptDifference;
      return stableRank(left.id, `${date}:fill`) -
        stableRank(right.id, `${date}:fill`);
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
    selectedTypeCounts,
    add,
    pick,
    fill
  };
}

function sortDueQuestions(questions, progressById, date) {
  return [...questions]
    .filter(question => isReviewDue(progressById.get(question.id), date))
    .sort((left, right) => {
      const leftProgress = progressById.get(left.id);
      const rightProgress = progressById.get(right.id);
      return leftProgress.dueAt.localeCompare(rightProgress.dueAt) ||
        leftProgress.level - rightProgress.level ||
        stableRank(left.id, `${date}:review`) -
          stableRank(right.id, `${date}:review`);
    });
}

function pickWeakQuestions({
  questions,
  typeStats,
  selector,
  date,
  count
}) {
  const weakTypes = [...typeStats.values()]
    .filter(stats => stats.samples >= 2)
    .sort((left, right) => {
      return recentAccuracy(left) - recentAccuracy(right) ||
        right.samples - left.samples ||
        stableRank(left.typeId, `${date}:weak-type`) -
          stableRank(right.typeId, `${date}:weak-type`);
    });

  let picked = 0;
  for (const stats of weakTypes) {
    if (selector.selectedTypes.has(stats.typeId)) continue;
    const candidates = sortStable(
      questions.filter(question => question.typeId === stats.typeId),
      `${date}:weak-question`
    );
    const question = candidates.find(item =>
      !selector.selectedIds.has(item.id)
    );
    if (selector.add(question, "weak-type")) picked += 1;
    if (picked >= count) break;
  }
}

function pickRecentTypes({
  questions,
  typeStats,
  selector,
  date,
  count
}) {
  const recentTypes = [...typeStats.values()]
    .filter(stats => stats.lastAttemptAt > 0)
    .sort((left, right) =>
      right.lastAttemptAt - left.lastAttemptAt ||
      stableRank(left.typeId, `${date}:recent-type`) -
        stableRank(right.typeId, `${date}:recent-type`)
    );

  let picked = 0;
  for (const stats of recentTypes) {
    if (selector.selectedTypes.has(stats.typeId)) continue;
    const candidates = sortStable(
      questions.filter(question => question.typeId === stats.typeId),
      `${date}:recent-question`
    );
    const question = candidates.find(item =>
      !selector.selectedIds.has(item.id)
    );
    if (selector.add(question, "recent-type")) picked += 1;
    if (picked >= count) break;
  }
}

export function buildDailyQueue({
  date,
  questions,
  attempts = [],
  questionProgress = [],
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
  const selector = createSelector({
    questions,
    excludedQuestionIds,
    blockedQuestionIds,
    attemptCounts,
    date,
    targetSize
  });
  const dueQuestions = sortDueQuestions(questions, progressById, date);
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
      questions,
      typeStats,
      selector,
      date,
      count: 3
    });
    const newQuestions = sortStable(
      questions.filter(question =>
        !progressById.has(question.id) &&
        (attemptCounts.get(question.id) || 0) === 0
      ),
      `${date}:new`
    );
    selector.pick(newQuestions, 2, "new-question");

    const targetDifficulty = challengeDifficulty(
      questions,
      attempts,
      questionById
    );
    const challenges = sortStable(
      questions.filter(question =>
        Number(question.difficulty || 1) >= targetDifficulty
      ),
      `${date}:challenge`
    );
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
    const unseenQuestions = sortStable(
      questions.filter(question =>
        !attemptedTypes.has(question.typeId) &&
        (attemptCounts.get(question.id) || 0) === 0
      ),
      `${date}:unseen-type`
    );
    selector.pick(unseenQuestions, unseenTarget, "unseen-type");

    pickRecentTypes({
      questions,
      typeStats,
      selector,
      date,
      count: 2
    });

    const targetDifficulty = challengeDifficulty(
      questions,
      attempts,
      questionById
    );
    const challenges = sortStable(
      questions.filter(question =>
        Number(question.difficulty || 1) >= targetDifficulty
      ),
      `${date}:challenge`
    );
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
