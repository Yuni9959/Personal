import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDetailedAnalytics,
  median
} from "../js/analytics-model.js";

const cognitiveDomains = [
  { id: "figures", label: "도형", description: "도형 규칙" },
  { id: "attention", label: "주의", description: "선택적 주의" }
];
const types = [
  {
    id: "T01",
    title: "도형 합성",
    domainId: "figures",
    scoreGroup: "core"
  },
  {
    id: "T02",
    title: "도형 이동",
    domainId: "figures",
    scoreGroup: "core"
  },
  {
    id: "T23",
    title: "스트룹",
    domainId: "attention",
    scoreGroup: "supplemental"
  }
];
const questions = [
  {
    id: "T01-01",
    typeId: "T01",
    domainId: "figures",
    scoreGroup: "core",
    difficulty: 2
  },
  {
    id: "T02-01",
    typeId: "T02",
    domainId: "figures",
    scoreGroup: "core",
    difficulty: 4
  },
  {
    id: "T23-01",
    typeId: "T23",
    domainId: "attention",
    scoreGroup: "supplemental",
    difficulty: 1
  }
];
const errorTaxonomy = [
  { id: "direction-reversal", label: "방향 반전" },
  { id: "condition-misread", label: "조건 오독" }
];

function attempt(overrides = {}) {
  return {
    questionId: "T01-01",
    firstPass: true,
    eligibleForAbilityStats: true,
    correct: true,
    overtime: false,
    skipped: false,
    elapsedMs: 1000,
    submittedAt: 1000,
    inferredErrorTag: null,
    ...overrides
  };
}

test("중앙값은 홀수·짝수 표본과 빈 표본을 안전하게 계산한다", () => {
  assert.equal(median([]), null);
  assert.equal(median([300, 100, 200]), 200);
  assert.equal(median([100, 200, 300, 400]), 250);
  assert.equal(median([100, Number.NaN, -1, 300]), 200);
});

test("핵심 추론과 보조 유형을 분리하고 유형별 최근 표본을 계산한다", () => {
  const analytics = buildDetailedAnalytics({
    questions,
    types,
    cognitiveDomains,
    errorTaxonomy,
    attempts: [
      attempt(),
      attempt({
        correct: false,
        overtime: true,
        elapsedMs: 3000,
        submittedAt: 2000,
        inferredErrorTag: "direction-reversal"
      }),
      attempt({
        questionId: "T23-01",
        domainId: "knowledge-memory",
        scoreGroup: "core",
        elapsedMs: 2000,
        submittedAt: 3000
      }),
      attempt({
        questionId: "T02-01",
        eligibleForAbilityStats: false,
        correct: false,
        submittedAt: 4000,
        inferredErrorTag: "condition-misread"
      }),
      attempt({
        questionId: "T02-01",
        firstPass: false,
        eligibleForAbilityStats: false,
        correct: false,
        submittedAt: 5000,
        inferredErrorTag: "condition-misread"
      }),
      attempt({
        questionId: "T02-01",
        skipped: true,
        correct: false,
        submittedAt: 6000
      })
    ]
  });

  assert.equal(analytics.firstPass.attempts, 4);
  assert.equal(analytics.firstPass.accuracy, 50);
  assert.equal(analytics.timedAccuracy, 50);
  assert.equal(analytics.coreAbility.attempts, 2);
  assert.equal(analytics.coreAbility.accuracy, 50);
  assert.equal(analytics.supplementalAbility.attempts, 1);
  assert.equal(analytics.supplementalAbility.accuracy, 100);

  const typeT01 = analytics.typeRows.find(row => row.id === "T01");
  assert.equal(typeT01.totalSamples, 2);
  assert.equal(typeT01.accuracy, 50);
  assert.equal(typeT01.medianElapsedMs, 2000);
  assert.equal(typeT01.sampleSufficient, true);

  assert.equal(analytics.domainRows.length, 1);
  assert.equal(analytics.domainRows[0].id, "figures");
  assert.equal(analytics.supplementalRows[0].id, "T23");
  assert.equal(
    analytics.difficultyRows.find(row => row.id === 2).attempts,
    2
  );
});

test("첫 제출 오답 원인과 다음 훈련 추천을 표본 규칙대로 만든다", () => {
  const analytics = buildDetailedAnalytics({
    questions,
    types,
    cognitiveDomains,
    errorTaxonomy,
    attempts: [
      attempt({
        correct: false,
        inferredErrorTag: "direction-reversal"
      }),
      attempt({
        correct: false,
        submittedAt: 2000,
        inferredErrorTag: "direction-reversal"
      }),
      attempt({
        questionId: "T02-01",
        eligibleForAbilityStats: false,
        correct: false,
        submittedAt: 3000,
        inferredErrorTag: "condition-misread"
      }),
      attempt({
        questionId: "T02-01",
        eligibleForAbilityStats: false,
        correct: false,
        submittedAt: 4000,
        inferredErrorTag: null
      })
    ]
  });

  assert.equal(analytics.errors.totalWrongFirstPass, 4);
  assert.equal(analytics.errors.classified, 3);
  assert.equal(analytics.errors.unclassified, 1);
  assert.deepEqual(
    analytics.errors.rows.map(row => [row.id, row.count, row.share]),
    [
      ["direction-reversal", 2, 50],
      ["condition-misread", 1, 25]
    ]
  );
  assert.equal(analytics.recommendations.weakTypes[0].id, "T01");
  assert.deepEqual(
    analytics.recommendations.collectingTypes.map(row => row.id),
    ["T02"]
  );
});
