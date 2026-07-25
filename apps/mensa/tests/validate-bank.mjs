import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradingFingerprint,
  optionSignature
} from "../tools/bank-utils.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, "..", "data", "question-bank.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const profileArg = process.argv.find(arg => arg.startsWith("--profile="));
const profile = profileArg?.split("=")[1] || "foundation";
const supportedProfiles = new Set(["foundation", "content-complete"]);

if (!supportedProfiles.has(profile)) {
  console.error(`지원하지 않는 검증 프로필입니다: ${profile}`);
  process.exit(1);
}

const errors = [];
const warnings = new Map();
const EXPECTED_TYPE_IDS = [
  "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08",
  "T09", "T10", "T11", "T12", "T13", "T14", "T15", "T16",
  "T17", "T18", "T20", "T21", "T22", "T23", "T24", "T25",
  "T26"
];
const EXPECTED_TYPE_COUNTS = {
  T01: 27, T02: 27, T03: 24, T04: 27, T05: 27,
  T06: 27, T07: 27, T08: 26, T09: 27, T10: 27,
  T11: 27, T12: 27, T13: 27, T14: 27, T15: 27,
  T16: 27, T17: 27, T18: 23, T20: 27, T21: 27,
  T22: 27, T23: 27, T24: 27, T25: 27, T26: 12
};
const EXPECTED_SOURCE_COUNTS = {
  "foundation-v1": 120,
  "advanced-v1": 232,
  "mkat-original-300-v1": 300
};

function addWarning(code, id) {
  const items = warnings.get(code) || [];
  items.push(id);
  warnings.set(code, items);
}

function checkSvg(svg, label) {
  if (typeof svg !== "string" ||
      !svg.trimStart().startsWith("<svg") ||
      !svg.trimEnd().endsWith("</svg>")) {
    errors.push(`SVG 형식 오류: ${label}`);
    return;
  }

  const unsafePatterns = [
    [/<script\b/i, "script 태그"],
    [/<foreignObject\b/i, "foreignObject 태그"],
    [/\son[a-z]+\s*=/i, "이벤트 속성"],
    [/\bjavascript\s*:/i, "javascript URL"],
    [/(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/)/i, "외부 URL"]
  ];

  for (const [pattern, description] of unsafePatterns) {
    if (pattern.test(svg)) {
      errors.push(`SVG 안전성 오류(${description}): ${label}`);
    }
  }
}

const visibleTextPatterns = [
  [/\b(?:left|right|LI|RO)\b/, "내부 방향 코드"],
  [/(?:지훈는|서윤가|서윤는|도윤가|도윤는|하린가|하린는|태현는)/, "이름 조사"],
  [/\b23가 됩니다\b/, "숫자 조사"],
  [/(?:안쪽가|바깥쪽가) 됩니다/, "위치 조사"],
  [/(?:빨강색|파랑색|노랑색)/, "색상 표현"]
];

function checkVisibleText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`사용자 문구 누락: ${label}`);
    return;
  }

  for (const [pattern, description] of visibleTextPatterns) {
    if (pattern.test(value)) {
      errors.push(`문장 품질 오류(${description}): ${label}`);
    }
  }
}

if (data.schemaVersion !== 2) {
  errors.push(`schemaVersion이 2가 아닙니다: ${data.schemaVersion}`);
}
if (typeof data.bankVersion !== "string" || !data.bankVersion.trim()) {
  errors.push("bankVersion이 없습니다.");
}
if (data.contentQualityVersion !== 2) {
  errors.push(`콘텐츠 품질 버전이 2가 아닙니다: ${data.contentQualityVersion}`);
}
if (!Array.isArray(data.types) || data.types.length !== 25) {
  errors.push(`유형 수가 25가 아닙니다: ${data.types?.length}`);
}
if (!Array.isArray(data.questions) || data.questions.length !== 652) {
  errors.push(`문제 수가 652가 아닙니다: ${data.questions?.length}`);
}
if (!Array.isArray(data.cognitiveDomains) ||
    data.cognitiveDomains.length !== 6) {
  errors.push(
    `인지 영역 수가 6이 아닙니다: ${data.cognitiveDomains?.length}`
  );
}
if (data.policy?.generalKnowledgeExcluded !== true ||
    !data.policy?.retiredTypeIds?.includes("T19")) {
  errors.push("T19 일반지식 제외 정책 메타데이터가 없습니다.");
}
if (!Array.isArray(data.retiredQuestions) ||
    data.retiredQuestions.length !== 8) {
  errors.push(`중복 폐기 문항 수 오류: ${data.retiredQuestions?.length}`);
}

const typeIds = new Set();
const typeById = new Map();
const domainIds = new Set();
for (const domain of Array.isArray(data.cognitiveDomains)
  ? data.cognitiveDomains
  : []) {
  if (!domain || typeof domain !== "object") {
    errors.push("인지 영역 형식 오류");
    continue;
  }
  if (typeof domain.id !== "string" || !domain.id.trim()) {
    errors.push("인지 영역 ID 누락");
  } else if (domainIds.has(domain.id)) {
    errors.push(`중복 인지 영역 ID: ${domain.id}`);
  } else {
    domainIds.add(domain.id);
  }
  checkVisibleText(domain.label, `${domain.id || "unknown"}.label`);
  checkVisibleText(
    domain.description,
    `${domain.id || "unknown"}.description`
  );
}

if (!Array.isArray(data.errorTaxonomy) || !data.errorTaxonomy.length) {
  errors.push("오류 분류표가 없습니다.");
}
const errorTagIds = new Set();
for (const item of Array.isArray(data.errorTaxonomy)
  ? data.errorTaxonomy
  : []) {
  if (!item || typeof item !== "object") {
    errors.push("오류 분류표 형식 오류");
    continue;
  }
  if (typeof item.id !== "string" || !item.id.trim()) {
    errors.push("오류 태그 ID 누락");
  } else if (errorTagIds.has(item.id)) {
    errors.push(`중복 오류 태그 ID: ${item.id}`);
  } else {
    errorTagIds.add(item.id);
  }
  checkVisibleText(item.label, `${item.id || "unknown"}.label`);
}

for (const type of data.types || []) {
  if (typeIds.has(type.id)) errors.push(`중복 유형 ID: ${type.id}`);
  typeIds.add(type.id);
  typeById.set(type.id, type);

  if (!Number.isInteger(type.count) || type.count < 1) {
    errors.push(`유형 count 오류: ${type.id}`);
  }
  if (!domainIds.has(type.domainId)) {
    errors.push(`유형 인지 영역 오류: ${type.id} → ${type.domainId}`);
  }
  if (!["core", "supplemental"].includes(type.scoreGroup)) {
    errors.push(`유형 점수 그룹 오류: ${type.id} → ${type.scoreGroup}`);
  }
}
if ([...typeIds].join(",") !== EXPECTED_TYPE_IDS.join(",")) {
  errors.push(`활성 유형 ID 불일치: ${[...typeIds].join(",")}`);
}

const supplementalTypeIds = (data.types || [])
  .filter(type => type.scoreGroup === "supplemental")
  .map(type => type.id)
  .sort();
if (supplementalTypeIds.join(",") !== "T23") {
  errors.push(
    `보조 점수 유형이 T23과 다릅니다: ${supplementalTypeIds.join(",")}`
  );
}

const questionIds = new Set();
const optionIds = new Set();
const answerPositionsByOptionCount = new Map();
const sourceCounts = new Map();

for (const question of data.questions || []) {
  if (questionIds.has(question.id)) errors.push(`중복 문제 ID: ${question.id}`);
  questionIds.add(question.id);

  if (!Number.isInteger(question.answerIndex) ||
      question.answerIndex < 0 ||
      question.answerIndex >= question.options?.length) {
    errors.push(`answerIndex 오류: ${question.id}`);
  }
  if (!Number.isInteger(question.contentVersion) || question.contentVersion < 1) {
    errors.push(`contentVersion 오류: ${question.id}`);
  }
  if (question.contentQualityVersion !== data.contentQualityVersion) {
    addWarning("문항 콘텐츠 품질 버전 불일치", question.id);
  }
  if (!typeById.has(question.typeId)) {
    errors.push(`알 수 없는 유형 참조: ${question.id} → ${question.typeId}`);
  } else if (typeById.get(question.typeId).title !== question.typeTitle) {
    errors.push(`유형 제목 불일치: ${question.id}`);
  }
  if (question.typeId === "T19") {
    errors.push(`폐기 유형 T19 문항 포함: ${question.id}`);
  }
  const sourceId = question.provenance?.sourceId;
  if (!EXPECTED_SOURCE_COUNTS[sourceId]) {
    errors.push(`문항 출처 오류: ${question.id} → ${sourceId}`);
  } else {
    sourceCounts.set(sourceId, (sourceCounts.get(sourceId) || 0) + 1);
  }
  if (!Number.isInteger(question.difficulty) ||
      question.difficulty < 1 ||
      question.difficulty > 5) {
    errors.push(`난이도 범위 오류: ${question.id}`);
  }
  if (!Number.isInteger(question.timeLimitSec) ||
      question.timeLimitSec < 10 ||
      question.timeLimitSec > 300) {
    errors.push(`제한시간 범위 오류: ${question.id}`);
  }
  if (!Array.isArray(question.skills) || !question.skills.length) {
    errors.push(`기술 태그 누락: ${question.id}`);
  }
  const type = typeById.get(question.typeId);
  if (type &&
      (question.domainId !== type.domainId ||
       question.scoreGroup !== type.scoreGroup)) {
    errors.push(`문항 인지 영역 불일치: ${question.id}`);
  }
  if (!Array.isArray(question.options) ||
      ![6, 8].includes(question.options.length)) {
    errors.push(`보기 수 오류: ${question.id} (${question.options?.length})`);
    continue;
  }

  checkVisibleText(question.prompt, `${question.id}.prompt`);
  checkVisibleText(question.trap, `${question.id}.trap`);
  checkSvg(question.stimulusSvg, `${question.id}.stimulusSvg`);

  const explanation = question.explanation;
  const structuredExplanation =
    explanation &&
    typeof explanation === "object" &&
    !Array.isArray(explanation) &&
    ["rule", "application", "verification"].every(
      key => typeof explanation[key] === "string" &&
        explanation[key].trim()
    );
  if (!structuredExplanation) {
    addWarning("구조화 해설 미완료", question.id);
    if (typeof explanation === "string") {
      checkVisibleText(explanation, `${question.id}.explanation`);
    }
  } else {
    for (const key of ["rule", "application", "verification"]) {
      checkVisibleText(
        explanation[key],
        `${question.id}.explanation.${key}`
      );
    }
  }

  const difficultyProfile = question.difficultyProfile;
  const difficultyKeys = [
    "overall",
    "ruleSteps",
    "attributeLoad",
    "workingMemory",
    "visualComplexity",
    "distractorSimilarity",
    "timePressure"
  ];
  const completeDifficulty =
    difficultyProfile &&
    typeof difficultyProfile === "object" &&
    Number.isInteger(difficultyProfile.sourceDifficulty) &&
    difficultyProfile.sourceDifficulty >= 1 &&
    difficultyProfile.sourceDifficulty <= 8 &&
    difficultyKeys.every(key =>
      Number.isInteger(difficultyProfile[key]) &&
      difficultyProfile[key] >= 1 &&
      difficultyProfile[key] <= 5
    ) &&
    typeof difficultyProfile.rationale === "string" &&
    difficultyProfile.rationale.trim();
  if (!completeDifficulty) {
    addWarning("다차원 난이도 미완료", question.id);
  } else {
    if (difficultyProfile.overall !== question.difficulty) {
      errors.push(`종합 난이도 불일치: ${question.id}`);
    }
    checkVisibleText(
      difficultyProfile.rationale,
      `${question.id}.difficultyProfile.rationale`
    );
  }

  if (!Array.isArray(question.hints) ||
      question.hints.length < 2 ||
      question.hints.some(hint =>
        typeof hint !== "string" || !hint.trim()
      )) {
    addWarning("단계별 힌트 미완료", question.id);
  } else {
    question.hints.forEach((hint, index) => {
      checkVisibleText(hint, `${question.id}.hints[${index}]`);
    });
  }

  const expectedFingerprint = gradingFingerprint(question);
  if (question.gradingFingerprint !== expectedFingerprint) {
    errors.push(`gradingFingerprint 불일치: ${question.id}`);
  }

  const signatures = [];
  let correctOption = null;

  for (const option of question.options) {
    if (typeof option.id !== "string" ||
        !option.id.startsWith(`${question.id}-O`)) {
      errors.push(`옵션 ID 형식 오류: ${question.id} → ${option.id}`);
    }
    if (optionIds.has(option.id)) errors.push(`중복 옵션 ID: ${option.id}`);
    optionIds.add(option.id);

    const hasText = option.text != null;
    const hasSvg = option.svg != null;
    if (hasText === hasSvg) {
      errors.push(`옵션 콘텐츠 형식 오류: ${option.id}`);
    }
    if (hasText) checkVisibleText(option.text, `${option.id}.text`);
    if (option.suffix != null) {
      checkVisibleText(option.suffix, `${option.id}.suffix`);
    }
    if (hasSvg) checkSvg(option.svg, `${option.id}.svg`);

    signatures.push(optionSignature(option));
    if (option.id === question.correctOptionId) correctOption = option;
  }

  if (!correctOption) {
    errors.push(`정답 옵션 ID 오류: ${question.id} → ${question.correctOptionId}`);
  } else {
    if (question.options[question.answerIndex]?.id !==
        question.correctOptionId) {
      errors.push(`정답 인덱스 불일치: ${question.id}`);
    }
    const optionCount = question.options.length;
    const positions = answerPositionsByOptionCount.get(optionCount) ||
      Array(optionCount).fill(0);
    positions[question.options.indexOf(correctOption)] += 1;
    answerPositionsByOptionCount.set(optionCount, positions);
  }
  if (new Set(signatures).size !== signatures.length) {
    errors.push(`중복 보기: ${question.id}`);
  }

  for (const option of question.options) {
    if (option.id === question.correctOptionId) {
      if (option.errorTag != null || option.feedback != null) {
        errors.push(`정답 보기에 오류 피드백이 있습니다: ${option.id}`);
      }
      continue;
    }
    if (!option.errorTag) addWarning("오답 errorTag 미작성", option.id);
    else if (!errorTagIds.has(option.errorTag)) {
      errors.push(`알 수 없는 errorTag: ${option.id} → ${option.errorTag}`);
    }
    if (!option.feedback) {
      addWarning("오답 feedback 미작성", option.id);
    } else {
      checkVisibleText(option.feedback, `${option.id}.feedback`);
    }
  }
}

for (const type of data.types || []) {
  const actualCount = (data.questions || [])
    .filter(question => question.typeId === type.id)
    .length;
  if (actualCount !== type.count) {
    errors.push(`${type.id} 문제 수 불일치: 선언 ${type.count}, 실제 ${actualCount}`);
  }
  if (EXPECTED_TYPE_COUNTS[type.id] !== actualCount) {
    errors.push(
      `${type.id} 기대 문제 수 불일치: ` +
      `${EXPECTED_TYPE_COUNTS[type.id]} != ${actualCount}`
    );
  }
}

if (optionIds.size !== 4270) {
  errors.push(`전체 옵션 수가 4270이 아닙니다: ${optionIds.size}`);
}
for (const [sourceId, expectedCount] of Object.entries(
  EXPECTED_SOURCE_COUNTS
)) {
  if (sourceCounts.get(sourceId) !== expectedCount) {
    errors.push(
      `${sourceId} 출처 문항 수 불일치: ` +
      `${sourceCounts.get(sourceId)} != ${expectedCount}`
    );
  }
}

const answerPositionSummaries = [];
for (const [optionCount, positions] of [...answerPositionsByOptionCount.entries()]
  .sort(([left], [right]) => left - right)) {
  const questionCount = positions.reduce((sum, count) => sum + count, 0);
  const expectedCount = questionCount / optionCount;
  const maxCount = Math.max(...positions);
  const maxIndex = positions.indexOf(maxCount);

  if (questionCount >= optionCount * 2 && positions.some(count => count === 0)) {
    addWarning(
      "정답 위치 편향",
      `${optionCount}지선다에서 사용하지 않은 정답 위치가 있습니다.`
    );
  } else if (questionCount >= optionCount * 3 &&
             maxCount >= expectedCount * 2) {
    addWarning(
      "정답 위치 편향",
      `${optionCount}지선다 ${maxIndex + 1}번: ${maxCount}/${questionCount}`
    );
  }

  answerPositionSummaries.push(
    `${optionCount}지선다 [` +
    positions.map((count, index) => `${index + 1}:${count}`).join(", ") +
    "]"
  );
}

if (profile === "content-complete") {
  for (const [code, ids] of warnings) {
    errors.push(`${code}: ${ids.length}개`);
  }
}

if (errors.length) {
  console.error(`검증 실패: 오류 ${errors.length}건`);
  errors.slice(0, 50).forEach(error => console.error(`- ${error}`));
  if (errors.length > 50) {
    console.error(`- 그 외 ${errors.length - 50}건`);
  }
  process.exit(1);
}

const warningTotal = [...warnings.values()]
  .reduce((sum, items) => sum + items.length, 0);

console.log(
  `검증 성공: ${data.types.length}개 유형, ${data.questions.length}개 문제, ` +
  `${optionIds.size}개 옵션, 오류 0건`
);
console.log(`정답 위치 분포: ${answerPositionSummaries.join("; ")}`);
console.log(`품질 경고: ${warningTotal}건 (${profile} 프로필)`);
for (const [code, ids] of warnings) {
  console.log(`- ${code}: ${ids.length}개`);
}
