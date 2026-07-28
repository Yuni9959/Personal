import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  enrichBank,
  assertGradingInvariants,
  TARGET_BANK_VERSION
} from "./enrich-content-v2.mjs";
import { gradingFingerprint } from "./bank-utils.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mensaRoot = path.resolve(here, "..");
const dataRoot = path.join(mensaRoot, "data");
const bankPath = path.join(dataRoot, "question-bank.json");
const advancedPath = path.join(
  dataRoot,
  "advanced-question-bank-v1.json"
);
const sourceRoot = path.join(dataRoot, "sources");
const sourceManifestPath = path.join(
  sourceRoot,
  "mkat-original-300-v1.manifest.json"
);
const sourceGzipPath = path.join(
  sourceRoot,
  "mkat-original-300-v1.json.gz"
);
const mensaNoManifestPath = path.join(
  sourceRoot,
  "mkat-mensano-350-v1.manifest.json"
);
const mensaNoGzipPath = path.join(
  sourceRoot,
  "mkat-mensano-350-v1.json.gz"
);

const LEGACY_TYPE_IDS = Object.freeze([
  "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08",
  "T09", "T10", "T11", "T12", "T13", "T14", "T15", "T16",
  "T17", "T18", "T20", "T21", "T22", "T23", "T24", "T25",
  "T26"
]);
const MENSA_NO_TYPE_IDS = Object.freeze(Array.from(
  { length: 35 },
  (_, index) => `S${String(index + 1).padStart(2, "0")}`
));
const EXPECTED_TYPE_IDS = Object.freeze([
  ...LEGACY_TYPE_IDS,
  ...MENSA_NO_TYPE_IDS
]);
const TYPE_ORDER = new Map(
  EXPECTED_TYPE_IDS.map((typeId, index) => [typeId, index])
);
const EXPECTED_QUESTION_COUNT = 1002;
const EXPECTED_OPTION_COUNT = 6370;
const RETIRED_DUPLICATE_QUESTIONS = Object.freeze([
  {
    id: "T03-10",
    duplicateOf: "T03-06",
    reason: "동일 자극·정답의 난이도만 다른 사본"
  },
  {
    id: "T03-11",
    duplicateOf: "T03-07",
    reason: "동일 자극·정답의 난이도만 다른 사본"
  },
  {
    id: "T03-14",
    duplicateOf: "T03-06",
    reason: "동일 자극·정답의 난이도만 다른 사본"
  },
  {
    id: "T08-15",
    duplicateOf: "T08-11",
    reason: "동일 자극·정답의 보기 순서만 다른 사본"
  },
  {
    id: "T18-12",
    duplicateOf: "T18-06",
    reason: "동일 등가식·정답의 보기 순서만 다른 사본"
  },
  {
    id: "T18-13",
    duplicateOf: "T18-07",
    reason: "동일 등가식·정답의 보기 순서만 다른 사본"
  },
  {
    id: "T18-14",
    duplicateOf: "T18-08",
    reason: "동일 등가식·정답의 보기 순서만 다른 사본"
  },
  {
    id: "T18-15",
    duplicateOf: "T18-09",
    reason: "동일 등가식·정답의 보기 순서만 다른 사본"
  }
]);
const RETIRED_DUPLICATE_IDS = new Set(
  RETIRED_DUPLICATE_QUESTIONS.map(question => question.id)
);
const ADVANCED_SHA256 =
  "1e7c4ce581dc26c044a5de06b8a446512e2bce9c206b230058d97f645d1d7dff";
const PROHIBITED_GENERAL_KNOWLEDGE =
  /(세계\s*수도|국가의\s*수도|도시-수도|country-to-capital)/i;
const UNSAFE_SVG_PATTERNS = Object.freeze([
  /<\s*script\b/i,
  /<\s*foreignObject\b/i,
  /<\s*iframe\b/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /\b(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/)/i
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceQuestionNumber(question) {
  return Number(question.id.split("-").at(-1));
}

function typeSort(left, right) {
  return (TYPE_ORDER.get(left.typeId) ?? Number.MAX_SAFE_INTEGER) -
    (TYPE_ORDER.get(right.typeId) ?? Number.MAX_SAFE_INTEGER) ||
    sourceQuestionNumber(left) - sourceQuestionNumber(right);
}

function stableOptionId(questionId, optionIndex) {
  return `${questionId}-O${optionIndex + 1}`;
}

function optionContentKey(option) {
  return JSON.stringify({
    text: option.text ?? null,
    svg: option.svg ?? null,
    suffix: option.suffix ?? null
  });
}

function canonicalStimulusForDuplicateAudit(svg) {
  return String(svg || "")
    .replace(/<text\b[^>]*>\s*S\d{2}\s*<\/text>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeSvg(svg, location) {
  if (typeof svg !== "string" ||
      !svg.trimStart().startsWith("<svg") ||
      !svg.trimEnd().endsWith("</svg>")) {
    throw new Error(`SVG 루트 오류: ${location}`);
  }
  if (UNSAFE_SVG_PATTERNS.some(pattern => pattern.test(svg))) {
    throw new Error(`안전하지 않은 SVG 구문: ${location}`);
  }
}

function parseSvgAttributes(source) {
  return Object.fromEntries(
    [...source.matchAll(/([:\w-]+)="([^"]*)"/g)]
      .map(match => [match[1], match[2]])
  );
}

function parseCubeNet(svg, location) {
  const cells = [...svg.matchAll(/<rect\b([^>]*)>/g)]
    .map(match => parseSvgAttributes(match[1]))
    .filter(attributes => {
      const width = Number(attributes.width);
      const height = Number(attributes.height);
      return Number.isFinite(Number(attributes.x)) &&
        Number.isFinite(Number(attributes.y)) &&
        Number.isFinite(width) &&
        Math.abs(width - height) < 0.2 &&
        width < 100;
    })
    .map(attributes => ({
      x: Number(attributes.x),
      y: Number(attributes.y),
      size: Number(attributes.width)
    }));
  if (cells.length !== 6) {
    throw new Error(`전개도 정사각형 수 오류: ${location}`);
  }
  const unit = cells.reduce((sum, cell) => sum + cell.size, 0) / cells.length;
  const minX = Math.min(...cells.map(cell => cell.x));
  const minY = Math.min(...cells.map(cell => cell.y));
  return cells.map(cell => [
    Math.round((cell.x - minX) / unit),
    Math.round((cell.y - minY) / unit)
  ]);
}

function negateVector(vector) {
  return vector.map(value => -value);
}

function nextFaceOrientation(orientation, dx, dy) {
  const [right, down, normal] = orientation;
  if (dx === 1) return [negateVector(normal), down, right];
  if (dx === -1) return [normal, down, negateVector(right)];
  if (dy === 1) return [right, negateVector(normal), down];
  return [right, normal, negateVector(down)];
}

function isCubeNet(cells) {
  const cellsByPosition = new Set(cells.map(cell => cell.join(",")));
  const start = cells[0];
  const queue = [start];
  const orientations = new Map([
    [start.join(","), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]]
  ]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [x, y] = queue[cursor];
    const orientation = orientations.get(`${x},${y}`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighborKey = `${x + dx},${y + dy}`;
      if (!cellsByPosition.has(neighborKey)) continue;
      const next = nextFaceOrientation(orientation, dx, dy);
      if (orientations.has(neighborKey)) {
        if (orientations.get(neighborKey).flat().join(",") !==
            next.flat().join(",")) {
          return false;
        }
      } else {
        orientations.set(neighborKey, next);
        queue.push([x + dx, y + dy]);
      }
    }
  }
  return orientations.size === 6 &&
    new Set(
      [...orientations.values()]
        .map(orientation => orientation[2].join(","))
    ).size === 6;
}

function normalizedValidation(question) {
  if (question.typeId !== "T24") return question.validation;
  const optionValidity = question.options.map((option, optionIndex) =>
    isCubeNet(parseCubeNet(option.svg, `${question.id}-O${optionIndex + 1}`))
  );
  const desired = question.validation.askInvalid ? false : true;
  const desiredIndexes = optionValidity
    .map((valid, index) => valid === desired ? index : null)
    .filter(index => index != null);
  if (desiredIndexes.length !== 1 ||
      desiredIndexes[0] !== question.answerIndex) {
    throw new Error(
      `전개도 정답 독립 검증 실패: ${question.id} ` +
      `(기대 ${question.answerIndex}, 계산 ${desiredIndexes.join(",")})`
    );
  }
  const sourceOptionValidity = question.validation.optionValidity;
  const corrected = JSON.stringify(sourceOptionValidity) !==
    JSON.stringify(optionValidity);
  return {
    ...question.validation,
    optionValidity,
    ...(corrected
      ? {
          sourceOptionValidity,
          optionValidityCorrected: true,
          correctionMethod: "independent SVG 3D orientation propagation"
        }
      : {})
  };
}

function normalizeOptions(question, { preserveSourceIds = false } = {}) {
  const correctSourceId = question.correctOptionId;
  const options = question.options.map((sourceOption, optionIndex) => {
    const {
      id: sourceOptionId,
      errorTag: sourceErrorTag,
      ...content
    } = sourceOption;
    const option = {
      id: stableOptionId(question.id, optionIndex),
      ...content
    };
    if (preserveSourceIds && sourceOptionId) {
      option.sourceOptionId = sourceOptionId;
    }
    if (sourceErrorTag) {
      option.sourceErrorTag = sourceErrorTag;
    }
    return option;
  });
  const answerIndex = Number.isInteger(question.answerIndex)
    ? question.answerIndex
    : question.options.findIndex(option => option.id === correctSourceId);
  if (answerIndex < 0 || answerIndex >= options.length) {
    throw new Error(`정답 인덱스 오류: ${question.id}`);
  }
  if (correctSourceId &&
      question.options[answerIndex]?.id !== correctSourceId) {
    throw new Error(`원본 정답 ID와 인덱스 불일치: ${question.id}`);
  }

  return {
    options,
    answerIndex,
    correctOptionId: options[answerIndex].id
  };
}

function normalizeFoundationQuestion(question) {
  const answerIndex = question.options.findIndex(
    option => option.id === question.correctOptionId
  );
  if (answerIndex < 0) {
    throw new Error(`Foundation 정답 옵션 누락: ${question.id}`);
  }
  return {
    ...question,
    answerIndex,
    provenance: {
      sourceId: "foundation-v1",
      sourceVersion: "foundation-125-v2",
      sourceQuestionId: question.id,
      importedAt: "2026-07-25"
    }
  };
}

function normalizeAdvancedQuestion(question) {
  const normalized = normalizeOptions(question);
  return {
    ...question,
    ...normalized,
    validation: normalizedValidation(question),
    contentVersion: 1,
    provenance: {
      sourceId: "advanced-v1",
      sourceVersion: "advanced-v1-2026-07-25",
      sourceQuestionId: question.id,
      importedAt: "2026-07-25"
    }
  };
}

function normalizeOriginal300Question(question) {
  const normalized = normalizeOptions(question, {
    preserveSourceIds: true
  });
  const {
    stimulus,
    difficultyProfile: authoringDifficultyProfile,
    domainId: sourceDomainId,
    ...sourceQuestion
  } = question;
  return {
    ...sourceQuestion,
    ...normalized,
    validation: normalizedValidation(question),
    contentVersion: Number(question.contentVersion) || 1,
    sourceDomainId,
    stimulusKind: stimulus?.kind || "svg",
    authoringDifficultyProfile,
    provenance: {
      sourceId: "mkat-original-300-v1",
      sourceVersion: "original-300-v1-2026-07-25",
      sourceQuestionId: question.id,
      importedAt: "2026-07-25",
      generatedOriginal: true
    }
  };
}

function normalizeMensaNo350Question(question) {
  const normalized = normalizeOptions(question, {
    preserveSourceIds: true
  });
  const {
    stimulus,
    difficultyProfile: authoringDifficultyProfile,
    domainId: sourceDomainId,
    ...sourceQuestion
  } = question;
  const options = normalized.options.map(option => {
    if (option.feedback !== "정답 규칙을 다시 확인하세요.") {
      return option;
    }
    const { feedback, ...withoutPlaceholder } = option;
    return withoutPlaceholder;
  });
  const stepSkills = Array.isArray(question.explanationSteps)
    ? question.explanationSteps
      .map(step => step?.label)
      .filter(label => typeof label === "string" && label.trim())
    : [];
  const explanationSteps = Array.isArray(question.explanationSteps)
    ? question.explanationSteps.map(step => ({
        ...step,
        text: String(step.text || "")
          .replace(/\bleft쪽/g, "왼쪽")
          .replace(/\bright쪽/g, "오른쪽")
      }))
    : [];
  return {
    ...sourceQuestion,
    ...normalized,
    options,
    correctOptionId: options[normalized.answerIndex].id,
    contentVersion: Number(question.contentVersion) || 1,
    sourceDomainId,
    stimulusKind: stimulus?.kind || "svg",
    authoringDifficultyProfile,
    explanationSteps,
    skills: stepSkills.length ? stepSkills : question.skills,
    provenance: {
      sourceId: "mkat-mensano-350-v1",
      sourceVersion: "source35-350-v1-2026-07-28",
      sourceQuestionId: question.id,
      sourceExercise: question.sourceExercise,
      importedAt: "2026-07-28",
      generatedOriginal: true
    }
  };
}

function expectedIdsForType(typeId) {
  if (MENSA_NO_TYPE_IDS.includes(typeId)) {
    return Array.from(
      { length: 10 },
      (_, index) => `${typeId}-${String(index + 1).padStart(2, "0")}`
    );
  }
  if (typeId === "T26") {
    return Array.from(
      { length: 12 },
      (_, index) => `${typeId}-${String(index + 1).padStart(2, "0")}`
    );
  }
  return [
    ...Array.from(
      { length: 5 },
      (_, index) => `${typeId}-${String(index + 1).padStart(2, "0")}`
    ),
    ...Array.from(
      { length: 10 },
      (_, index) => `${typeId}-${String(index + 6).padStart(2, "0")}`
    ),
    ...Array.from(
      { length: 12 },
      (_, index) => `${typeId}-${String(index + 16).padStart(2, "0")}`
    )
  ].filter(id => !RETIRED_DUPLICATE_IDS.has(id));
}

function sourceRangesForType(typeId) {
  if (MENSA_NO_TYPE_IDS.includes(typeId)) {
    return [{
      sourceId: "mkat-mensano-350-v1",
      range: `${typeId}-01~${typeId}-10`
    }];
  }
  return typeId === "T26"
    ? [{ sourceId: "mkat-original-300-v1", range: "T26-01~T26-12" }]
    : [
        { sourceId: "foundation-v1", range: `${typeId}-01~${typeId}-05` },
        { sourceId: "advanced-v1", range: `${typeId}-06~${typeId}-15` },
        {
          sourceId: "mkat-original-300-v1",
          range: `${typeId}-16~${typeId}-27`
        }
      ];
}

function assertExpandedBank(bank) {
  const errors = [];
  if (bank.schemaVersion !== 2) {
    errors.push(`schemaVersion=${bank.schemaVersion}`);
  }
  if (bank.bankVersion !== TARGET_BANK_VERSION) {
    errors.push(`bankVersion=${bank.bankVersion}`);
  }
  if (bank.questions.length !== EXPECTED_QUESTION_COUNT) {
    errors.push(`문항 수=${bank.questions.length}`);
  }
  if (bank.types.length !== EXPECTED_TYPE_IDS.length) {
    errors.push(`유형 수=${bank.types.length}`);
  }
  if (bank.questions.some(question => question.typeId === "T19") ||
      bank.types.some(type => type.id === "T19")) {
    errors.push("폐기 유형 T19 활성 데이터 포함");
  }

  const typeIds = bank.types.map(type => type.id);
  if (typeIds.join(",") !== EXPECTED_TYPE_IDS.join(",")) {
    errors.push(`유형 순서=${typeIds.join(",")}`);
  }
  const questionIds = new Set();
  const optionIds = new Set();
  const substantiveKeys = new Map();
  const completeVisualKeys = new Map();
  let optionCount = 0;
  for (const question of bank.questions) {
    if (questionIds.has(question.id)) {
      errors.push(`중복 문항 ID=${question.id}`);
    }
    questionIds.add(question.id);
    if (!EXPECTED_TYPE_IDS.includes(question.typeId)) {
      errors.push(`알 수 없는 유형=${question.id}:${question.typeId}`);
    }
    if (![6, 8].includes(question.options?.length)) {
      errors.push(`보기 수 오류=${question.id}:${question.options?.length}`);
      continue;
    }
    optionCount += question.options.length;
    const localContent = new Set();
    for (const [optionIndex, option] of question.options.entries()) {
      const expectedOptionId = stableOptionId(question.id, optionIndex);
      if (option.id !== expectedOptionId) {
        errors.push(`보기 ID 오류=${option.id}:${expectedOptionId}`);
      }
      if (optionIds.has(option.id)) {
        errors.push(`중복 보기 ID=${option.id}`);
      }
      optionIds.add(option.id);
      const contentKey = optionContentKey(option);
      if (localContent.has(contentKey)) {
        errors.push(`중복 보기 내용=${question.id}`);
      }
      localContent.add(contentKey);
      if (option.svg) {
        try {
          safeSvg(option.svg, option.id);
        } catch (error) {
          errors.push(error.message);
        }
      }
    }
    if (question.options[question.answerIndex]?.id !==
        question.correctOptionId) {
      errors.push(`정답 ID/인덱스 불일치=${question.id}`);
    }
    try {
      safeSvg(question.stimulusSvg, `${question.id}.stimulusSvg`);
    } catch (error) {
      errors.push(error.message);
    }
    if (question.difficulty < 1 || question.difficulty > 5) {
      errors.push(`실행 난이도 오류=${question.id}:${question.difficulty}`);
    }
    if (question.gradingFingerprint !== gradingFingerprint(question)) {
      errors.push(`채점 지문 불일치=${question.id}`);
    }
    const searchable = JSON.stringify({
      typeTitle: question.typeTitle,
      prompt: question.prompt,
      explanation: question.explanation,
      skills: question.skills,
      trap: question.trap,
      ruleSignature: question.ruleSignature
    });
    if (PROHIBITED_GENERAL_KNOWLEDGE.test(searchable)) {
      errors.push(`일반지식 표현 포함=${question.id}`);
    }

    const substantiveKey = sha256(JSON.stringify({
      typeId: question.typeId,
      prompt: question.prompt,
      stimulusSvg: question.typeId === "T24"
        ? null
        : question.stimulusSvg.replace(/\s+/g, " ").trim(),
      options: question.typeId === "T24"
        ? question.options.map(optionContentKey).sort()
        : null,
      correct: optionContentKey(
        question.options[question.answerIndex]
      )
    }));
    const existing = substantiveKeys.get(substantiveKey);
    if (existing) {
      errors.push(`실질 중복=${existing},${question.id}`);
    } else {
      substantiveKeys.set(substantiveKey, question.id);
    }
    const completeVisualKey = sha256(JSON.stringify({
      stimulusSvg: canonicalStimulusForDuplicateAudit(
        question.stimulusSvg
      ),
      options: question.options.map(optionContentKey).sort()
    }));
    const visualDuplicate = completeVisualKeys.get(completeVisualKey);
    if (visualDuplicate) {
      errors.push(`유형 간 시각 중복=${visualDuplicate},${question.id}`);
    } else {
      completeVisualKeys.set(completeVisualKey, question.id);
    }
  }
  if (optionCount !== EXPECTED_OPTION_COUNT) {
    errors.push(`보기 총수=${optionCount}`);
  }

  for (const typeId of EXPECTED_TYPE_IDS) {
    const actualIds = bank.questions
      .filter(question => question.typeId === typeId)
      .map(question => question.id);
    const expectedIds = expectedIdsForType(typeId);
    if (actualIds.join(",") !== expectedIds.join(",")) {
      errors.push(`${typeId} ID 범위 불일치`);
    }
    const type = bank.types.find(candidate => candidate.id === typeId);
    if (type?.count !== expectedIds.length) {
      errors.push(`${typeId} count=${type?.count}`);
    }
  }

  const provenanceCounts = bank.questions.reduce((counts, question) => {
    const id = question.provenance?.sourceId || "missing";
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
  const expectedProvenance = {
    "foundation-v1": 120,
    "advanced-v1": 232,
    "mkat-original-300-v1": 300,
    "mkat-mensano-350-v1": 350
  };
  if (Object.entries(expectedProvenance).some(
    ([sourceId, count]) => provenanceCounts[sourceId] !== count
  ) ||
      Object.keys(provenanceCounts).length !==
        Object.keys(expectedProvenance).length) {
    errors.push(`출처 분포=${JSON.stringify(provenanceCounts)}`);
  }

  if (errors.length) {
    throw new Error(
      `확장 문제은행 검증 실패 (${errors.length}건)\n` +
      errors.slice(0, 30).join("\n")
    );
  }
}

export function buildExpandedBank({
  currentBank,
  advancedBank,
  original300,
  sourceManifest,
  mensaNo350,
  mensaNoManifest
}) {
  if (sourceManifest.questionCount !== original300.questions?.length) {
    throw new Error("신규 300 원본과 출처 매니페스트의 문항 수가 다릅니다.");
  }
  if (mensaNoManifest.questionCount !== mensaNo350.questions?.length ||
      mensaNoManifest.activeTypeCount !== mensaNo350.types?.length ||
      mensaNo350.schemaVersion !== mensaNoManifest.sourceSchemaVersion) {
    throw new Error(
      "Mensa Norway 신규 350 원본과 출처 매니페스트가 다릅니다."
    );
  }
  const foundationQuestions = currentBank.questions
    .filter(question =>
      question.typeId !== "T19" &&
      question.originalPracticeItem === true &&
      sourceQuestionNumber(question) <= 5
    )
    .map(normalizeFoundationQuestion);
  const advancedQuestions = advancedBank.questions
    .filter(question =>
      question.typeId !== "T19" &&
      !RETIRED_DUPLICATE_IDS.has(question.id)
    )
    .map(normalizeAdvancedQuestion);
  const originalQuestions = original300.questions
    .map(normalizeOriginal300Question);
  const mensaNoQuestions = mensaNo350.questions
    .map(normalizeMensaNo350Question);
  if (foundationQuestions.length !== 120 ||
      advancedQuestions.length !== 232 ||
      originalQuestions.length !== 300 ||
      mensaNoQuestions.length !== 350) {
    throw new Error(
      "출처별 문항 수 불일치: " +
      `${foundationQuestions.length}/` +
      `${advancedQuestions.length}/` +
      `${originalQuestions.length}/` +
      `${mensaNoQuestions.length}`
    );
  }

  const questions = [
    ...foundationQuestions,
    ...advancedQuestions,
    ...originalQuestions,
    ...mensaNoQuestions
  ].sort(typeSort);
  const legacyTypes = original300.types
    .filter(type => type.id !== "T19")
    .map(type => {
      const {
        sourceRange,
        domainId: sourceDomainId,
        ...metadata
      } = type;
      return {
        ...metadata,
        sourceDomainId,
        count: expectedIdsForType(type.id).length,
        runtimeDifficultyRange: [1, 5],
        sourceRanges: sourceRangesForType(type.id)
      };
    });
  const mensaNoTypes = mensaNo350.types.map(type => {
    const {
      domainId: sourceDomainId,
      ...metadata
    } = type;
    const representative = mensaNo350.questions.find(
      question => question.typeId === type.id
    );
    return {
      ...metadata,
      domainTitle: "도형·행렬 추론",
      category: "Mensa Norway 유형 변형",
      description: [
        representative?.ruleSignature || type.title
      ],
      sourceDomainId,
      count: 10,
      runtimeDifficultyRange: [1, 5],
      sourceRanges: sourceRangesForType(type.id)
    };
  });
  const types = [
    ...legacyTypes,
    ...mensaNoTypes
  ].sort((left, right) =>
    (TYPE_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (TYPE_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );

  const rawBank = {
    schemaVersion: 2,
    bankVersion: TARGET_BANK_VERSION,
    contentQualityVersion: currentBank.contentQualityVersion || 1,
    title: "MKAT 통합 추론 문제은행",
    basis:
      "Foundation 120문항, 중복 제거 심화 232문항, 신규 오리지널 " +
      "300문항과 Mensa Norway 35개 원형 기반 독자 생성 350문항을 " +
      "T19 일반지식 제외 정책에 따라 통합한 앱 실행용 문제은행",
    policy: {
      totalQuestions: EXPECTED_QUESTION_COUNT,
      activeTypes: EXPECTED_TYPE_IDS.length,
      generalKnowledgeExcluded: true,
      retiredTypeIds: ["T19"],
      runtimeDifficultyRange: [1, 5],
      singleCorrectAnswer: true,
      stableGlobalOptionIds: true,
      sourceQuestionCounts: {
        foundation: 120,
        advanced: 232,
        original300: 300,
        mensaNo350: 350
      },
      importedQuestionCount: 1025,
      duplicateQuestionCount: RETIRED_DUPLICATE_QUESTIONS.length,
      excludedGeneralKnowledgeQuestionCount: 15,
      exactCrossSourceDuplicateQuestionCount: 0
    },
    retiredTypes: original300.retiredTypes,
    retiredQuestions: RETIRED_DUPLICATE_QUESTIONS.map(question => ({
      ...question,
      sourceId: "advanced-v1",
      status: "retired-duplicate"
    })),
    sourcePackages: [
      {
        sourceId: "foundation-v1",
        sourceVersion: "foundation-125-v2",
        activeQuestionCount: 120,
        retiredQuestionCount: 5
      },
      {
        sourceId: "advanced-v1",
        sourceVersion: advancedBank.version,
        sourceSha256: ADVANCED_SHA256,
        activeQuestionCount: 232,
        retiredQuestionCount: 18
      },
      {
        sourceId: sourceManifest.sourceId,
        sourceVersion: sourceManifest.packageVersion,
        sourceJsonSha256: sourceManifest.jsonSha256,
        sourceZipSha256: sourceManifest.zipSha256,
        activeQuestionCount: 300,
        retiredQuestionCount: 0
      },
      {
        sourceId: mensaNoManifest.sourceId,
        sourceVersion: mensaNoManifest.packageVersion,
        sourceJsonSha256: mensaNoManifest.jsonSha256,
        sourceZipSha256: mensaNoManifest.zipSha256,
        activeQuestionCount: 350,
        retiredQuestionCount: 0
      }
    ],
    types,
    questions
  };
  const enriched = enrichBank(rawBank);
  assertGradingInvariants(rawBank, enriched);
  assertExpandedBank(enriched);
  return enriched;
}

function loadSources() {
  const currentBank = readJson(bankPath);
  const advancedBytes = fs.readFileSync(advancedPath);
  if (sha256(advancedBytes) !== ADVANCED_SHA256) {
    throw new Error("심화 문제은행 SHA-256이 기준값과 다릅니다.");
  }
  const sourceManifest = readJson(sourceManifestPath);
  const storedSourceBytes = fs.readFileSync(sourceGzipPath);
  if (sha256(storedSourceBytes) !== sourceManifest.storedSha256) {
    throw new Error("압축 보관 원본 SHA-256이 매니페스트와 다릅니다.");
  }
  const originalBytes = zlib.gunzipSync(storedSourceBytes);
  if (sha256(originalBytes) !== sourceManifest.jsonSha256) {
    throw new Error("신규 300 원본 SHA-256이 매니페스트와 다릅니다.");
  }
  const mensaNoManifest = readJson(mensaNoManifestPath);
  const storedMensaNoBytes = fs.readFileSync(mensaNoGzipPath);
  if (sha256(storedMensaNoBytes) !== mensaNoManifest.storedSha256) {
    throw new Error(
      "Mensa Norway 신규 350 압축 원본 SHA-256이 매니페스트와 다릅니다."
    );
  }
  const mensaNoBytes = zlib.gunzipSync(storedMensaNoBytes);
  if (sha256(mensaNoBytes) !== mensaNoManifest.jsonSha256) {
    throw new Error(
      "Mensa Norway 신규 350 JSON SHA-256이 매니페스트와 다릅니다."
    );
  }
  return {
    currentBank,
    advancedBank: JSON.parse(
      advancedBytes.toString("utf8").replace(/^\uFEFF/, "")
    ),
    original300: JSON.parse(
      originalBytes.toString("utf8").replace(/^\uFEFF/, "")
    ),
    sourceManifest,
    mensaNo350: JSON.parse(
      mensaNoBytes.toString("utf8").replace(/^\uFEFF/, "")
    ),
    mensaNoManifest
  };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const expanded = buildExpandedBank(loadSources());
  const rendered = `${JSON.stringify(expanded, null, 2)}\n`;
  if (checkOnly) {
    if (fs.readFileSync(bankPath, "utf8") !== rendered) {
      throw new Error(
        "question-bank.json이 확장 원본에서 재생성한 결과와 다릅니다."
      );
    }
    console.log(
      `확장 문제은행 재현 확인: ${expanded.questions.length}문항, ` +
      `${expanded.types.length}유형`
    );
    return;
  }

  fs.writeFileSync(bankPath, rendered, "utf8");
  console.log(
    `확장 문제은행 생성 완료: ${expanded.questions.length}문항, ` +
    `${expanded.types.length}유형, ` +
    `${expanded.questions.reduce(
      (sum, question) => sum + question.options.length,
      0
    )}보기`
  );
}

if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
