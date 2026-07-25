export const RECENT_TYPE_WINDOW = 10;

function percentage(correct, attempts) {
  return attempts > 0
    ? Math.round(correct / attempts * 100)
    : null;
}

export function median(values) {
  const normalized = (values || [])
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!normalized.length) return null;

  const middle = Math.floor(normalized.length / 2);
  return normalized.length % 2
    ? normalized[middle]
    : Math.round((normalized[middle - 1] + normalized[middle]) / 2);
}

function summarize(attempts) {
  const correct = attempts.filter(attempt => attempt.correct).length;
  const overtime = attempts.filter(attempt => attempt.overtime).length;
  return {
    attempts: attempts.length,
    correct,
    accuracy: percentage(correct, attempts.length),
    overtime,
    overtimeRate: percentage(overtime, attempts.length),
    medianElapsedMs: median(attempts.map(attempt => attempt.elapsedMs))
  };
}

function attemptTime(attempt) {
  const value = Number(attempt?.submittedAt);
  return Number.isFinite(value) ? value : 0;
}

function withQuestionContext(attempt, questionById) {
  const question = questionById.get(attempt.questionId);
  if (!question) return null;

  return {
    ...attempt,
    typeId: attempt.typeId || question.typeId,
    domainId: attempt.domainId || question.domainId,
    scoreGroup: attempt.scoreGroup || question.scoreGroup || "core",
    difficulty: Number(attempt.difficulty || question.difficulty || 1)
  };
}

function weakestFirst(left, right) {
  const leftAccuracy = left.accuracy ?? Number.POSITIVE_INFINITY;
  const rightAccuracy = right.accuracy ?? Number.POSITIVE_INFINITY;
  return leftAccuracy - rightAccuracy ||
    (right.medianElapsedMs || 0) - (left.medianElapsedMs || 0) ||
    left.id.localeCompare(right.id);
}

export function buildDetailedAnalytics({
  attempts = [],
  questions = [],
  types = [],
  cognitiveDomains = [],
  errorTaxonomy = [],
  recentWindow = RECENT_TYPE_WINDOW
} = {}) {
  const questionById = new Map(
    questions.map(question => [question.id, question])
  );
  const ordered = attempts
    .filter(attempt =>
      attempt &&
      !attempt.skipped &&
      typeof attempt.questionId === "string"
    )
    .map(attempt => withQuestionContext(attempt, questionById))
    .filter(Boolean)
    .sort((left, right) => attemptTime(left) - attemptTime(right));
  const firstPass = ordered.filter(attempt => attempt.firstPass);
  const ability = ordered.filter(
    attempt => attempt.eligibleForAbilityStats
  );
  const coreAbility = ability.filter(
    attempt => attempt.scoreGroup === "core"
  );
  const supplementalAbility = ability.filter(
    attempt => attempt.scoreGroup === "supplemental"
  );
  const timedCorrect = firstPass.filter(
    attempt => attempt.correct && !attempt.overtime
  ).length;

  const typeRows = types.map(type => {
    const allSamples = ability.filter(attempt => attempt.typeId === type.id);
    const recentSamples = allSamples.slice(-recentWindow);
    return {
      id: type.id,
      title: type.title,
      domainId: type.domainId,
      scoreGroup: type.scoreGroup || "core",
      totalSamples: allSamples.length,
      recentWindow,
      ...summarize(recentSamples),
      sampleSufficient: allSamples.length >= 2
    };
  });

  const domainRows = cognitiveDomains.map(domain => {
    const samples = coreAbility.filter(
      attempt => attempt.domainId === domain.id
    );
    const domainTypeIds = types
      .filter(type =>
        type.domainId === domain.id &&
        (type.scoreGroup || "core") === "core"
      )
      .map(type => type.id);
    return {
      id: domain.id,
      label: domain.label,
      description: domain.description,
      typeIds: domainTypeIds,
      ...summarize(samples),
      sampleSufficient: samples.length >= 2
    };
  }).filter(row => row.typeIds.length > 0);

  const supplementalRows = typeRows.filter(
    row => row.scoreGroup === "supplemental"
  );
  const taxonomyById = new Map(
    errorTaxonomy.map(item => [item.id, item])
  );
  const wrongFirstPass = firstPass.filter(attempt => !attempt.correct);
  const errorCounts = new Map();
  let unclassifiedErrors = 0;
  for (const attempt of wrongFirstPass) {
    const tag = attempt.inferredErrorTag;
    if (!tag) {
      unclassifiedErrors += 1;
      continue;
    }
    errorCounts.set(tag, (errorCounts.get(tag) || 0) + 1);
  }
  const errorRows = [...errorCounts.entries()]
    .map(([id, count]) => ({
      id,
      label: taxonomyById.get(id)?.label || id,
      count,
      share: percentage(count, wrongFirstPass.length)
    }))
    .sort((left, right) =>
      right.count - left.count || left.label.localeCompare(right.label)
    );

  const difficultyRows = [1, 2, 3, 4, 5].map(difficulty => ({
    id: difficulty,
    ...summarize(
      coreAbility.filter(attempt => attempt.difficulty === difficulty)
    )
  }));
  const weakTypes = typeRows
    .filter(row =>
      row.scoreGroup === "core" &&
      row.sampleSufficient &&
      row.attempts > 0
    )
    .sort(weakestFirst)
    .slice(0, 3);
  const collectingTypes = typeRows
    .filter(row =>
      row.scoreGroup === "core" &&
      !row.sampleSufficient
    )
    .slice(0, 3);

  return {
    firstPass: summarize(firstPass),
    timedAccuracy: percentage(timedCorrect, firstPass.length),
    ability: summarize(ability),
    coreAbility: summarize(coreAbility),
    supplementalAbility: summarize(supplementalAbility),
    typeRows,
    domainRows,
    supplementalRows,
    difficultyRows,
    errors: {
      totalWrongFirstPass: wrongFirstPass.length,
      classified: wrongFirstPass.length - unclassifiedErrors,
      unclassified: unclassifiedErrors,
      rows: errorRows
    },
    recommendations: {
      weakTypes,
      collectingTypes,
      topErrors: errorRows.slice(0, 3)
    }
  };
}
