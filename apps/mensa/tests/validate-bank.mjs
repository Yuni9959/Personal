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
  [/(?:빨강색|파랑색)/, "색상 표현"]
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
if (!Array.isArray(data.types) || data.types.length !== 25) {
  errors.push(`유형 수가 25가 아닙니다: ${data.types?.length}`);
}
if (!Array.isArray(data.questions) || data.questions.length !== 125) {
  errors.push(`문제 수가 125가 아닙니다: ${data.questions?.length}`);
}

const typeIds = new Set();
const typeById = new Map();
for (const type of data.types || []) {
  if (typeIds.has(type.id)) errors.push(`중복 유형 ID: ${type.id}`);
  typeIds.add(type.id);
  typeById.set(type.id, type);

  if (!Number.isInteger(type.count) || type.count < 1) {
    errors.push(`유형 count 오류: ${type.id}`);
  }
}

const questionIds = new Set();
const optionIds = new Set();
const answerPositionsByOptionCount = new Map();

for (const question of data.questions || []) {
  if (questionIds.has(question.id)) errors.push(`중복 문제 ID: ${question.id}`);
  questionIds.add(question.id);

  if ("answerIndex" in question) {
    errors.push(`answerIndex가 남아 있습니다: ${question.id}`);
  }
  if (!Number.isInteger(question.contentVersion) || question.contentVersion < 1) {
    errors.push(`contentVersion 오류: ${question.id}`);
  }
  if (!typeById.has(question.typeId)) {
    errors.push(`알 수 없는 유형 참조: ${question.id} → ${question.typeId}`);
  } else if (typeById.get(question.typeId).title !== question.typeTitle) {
    errors.push(`유형 제목 불일치: ${question.id}`);
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
  if (!Array.isArray(question.options) ||
      question.options.length < 6 ||
      question.options.length > 9) {
    errors.push(`보기 수 오류: ${question.id} (${question.options?.length})`);
    continue;
  }

  checkVisibleText(question.prompt, `${question.id}.prompt`);
  checkVisibleText(question.explanation, `${question.id}.explanation`);
  checkVisibleText(question.trap, `${question.id}.trap`);
  checkSvg(question.stimulusSvg, `${question.id}.stimulusSvg`);

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
    if (option.id === question.correctOptionId) continue;
    if (!option.errorTag) addWarning("오답 errorTag 미작성", option.id);
    if (!option.feedback) addWarning("오답 feedback 미작성", option.id);
  }
  if (typeof question.explanation === "string") {
    addWarning("구조화 해설 미완료", question.id);
  }
  if (typeof question.difficulty === "number") {
    addWarning("다차원 난이도 미완료", question.id);
  }
  if (!Array.isArray(question.hints)) {
    addWarning("단계별 힌트 미완료", question.id);
  }
}

for (const type of data.types || []) {
  const actualCount = (data.questions || [])
    .filter(question => question.typeId === type.id)
    .length;
  if (actualCount !== type.count) {
    errors.push(`${type.id} 문제 수 불일치: 선언 ${type.count}, 실제 ${actualCount}`);
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
