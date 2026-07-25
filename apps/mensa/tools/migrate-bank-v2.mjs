import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradingFingerprint,
  optionSignature,
  sha256
} from "./bank-utils.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mensaRoot = path.resolve(here, "..");
const dataPath = path.join(mensaRoot, "data", "question-bank.json");
const fixtureDir = path.join(mensaRoot, "tests", "fixtures");
const baselinePath = path.join(fixtureDir, "question-bank-v1-baseline.json");

const raw = fs.readFileSync(dataPath, "utf8");
const source = JSON.parse(raw);

if (!Array.isArray(source.types) || !Array.isArray(source.questions)) {
  throw new Error("문제은행의 types 또는 questions 배열을 찾을 수 없습니다.");
}

fs.mkdirSync(fixtureDir, { recursive: true });

if (source.schemaVersion !== 2 && !fs.existsSync(baselinePath)) {
  const baseline = {
    fixtureVersion: 1,
    sourceSchemaVersion: 1,
    sourceSha256: sha256(raw),
    typeCount: source.types.length,
    questionCount: source.questions.length,
    optionCount: source.questions.reduce((sum, question) => sum + question.options.length, 0),
    questions: source.questions.map(question => {
      if (!Number.isInteger(question.answerIndex)) {
        throw new Error(`기준선 정답 인덱스가 없습니다: ${question.id}`);
      }

      return {
        id: question.id,
        typeId: question.typeId,
        answerIndex: question.answerIndex,
        optionCount: question.options.length,
        optionSignatures: question.options.map(optionSignature),
        correctOptionSignature: optionSignature(question.options[question.answerIndex]),
        stimulusSignature: sha256(question.stimulusSvg)
      };
    })
  };

  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`v1 기준선 fixture 생성: ${path.relative(mensaRoot, baselinePath)}`);
}

function correctVisibleText(value) {
  if (typeof value !== "string") return value;
  return value
    .replaceAll("left 쪽", "왼쪽")
    .replaceAll("right 쪽", "오른쪽")
    .replaceAll("왼쪽 바깥→왼쪽 안→오른쪽 바깥→가운데 안", "왼쪽 바깥쪽→왼쪽 안쪽→오른쪽 바깥쪽→가운데 안쪽")
    .replaceAll("점 위치 LI", "점 위치 왼쪽 안쪽")
    .replaceAll("점 위치 RO", "점 위치 오른쪽 바깥쪽")
    .replace(
      /삼각형 (\d+)개와 점 위치 (왼쪽 안쪽|오른쪽 바깥쪽)가 됩니다/g,
      "삼각형 $1개이고, 점은 $2에 놓입니다."
    )
    .replaceAll("23가 됩니다", "23이 됩니다")
    .replaceAll("지훈는", "지훈은")
    .replaceAll("서윤가", "서윤이가")
    .replaceAll("서윤는", "서윤은")
    .replaceAll("도윤가", "도윤이가")
    .replaceAll("도윤는", "도윤은")
    .replaceAll("하린가", "하린이가")
    .replaceAll("하린는", "하린은")
    .replaceAll("태현는", "태현은")
    .replaceAll("빨강색", "빨간색")
    .replaceAll("파랑색", "파란색")
    .replaceAll("노랑색", "노란색");
}

const questions = source.questions.map(question => {
  if (source.schemaVersion === 2) {
    const normalized = {
      ...question,
      prompt: correctVisibleText(question.prompt),
      options: question.options.map(option => ({
        ...option,
        ...(option.text != null ? { text: correctVisibleText(option.text) } : {}),
        ...(option.suffix != null ? { suffix: correctVisibleText(option.suffix) } : {})
      })),
      explanation: correctVisibleText(question.explanation),
      trap: correctVisibleText(question.trap)
    };

    return {
      ...normalized,
      gradingFingerprint: gradingFingerprint(normalized)
    };
  }

  if (!Number.isInteger(question.answerIndex) ||
      question.answerIndex < 0 ||
      question.answerIndex >= question.options.length) {
    throw new Error(`정답 인덱스 오류: ${question.id}`);
  }

  const options = question.options.map((option, index) => ({
    id: `${question.id}-O${index + 1}`,
    ...option,
    ...(option.text != null ? { text: correctVisibleText(option.text) } : {}),
    ...(option.suffix != null ? { suffix: correctVisibleText(option.suffix) } : {})
  }));

  const migrated = {
    id: question.id,
    contentVersion: 1,
    typeId: question.typeId,
    typeTitle: question.typeTitle,
    difficulty: question.difficulty,
    prompt: correctVisibleText(question.prompt),
    stimulusSvg: question.stimulusSvg,
    options,
    correctOptionId: options[question.answerIndex].id,
    explanation: correctVisibleText(question.explanation),
    skills: question.skills,
    trap: correctVisibleText(question.trap),
    timeLimitSec: question.timeLimitSec,
    originalPracticeItem: question.originalPracticeItem
  };

  return {
    ...migrated,
    gradingFingerprint: gradingFingerprint(migrated)
  };
});

const migratedBank = {
  schemaVersion: 2,
  bankVersion: source.schemaVersion === 2
    ? source.bankVersion
    : "2026.07.25-foundation.1",
  types: source.types,
  questions
};

fs.writeFileSync(dataPath, `${JSON.stringify(migratedBank, null, 2)}\n`, "utf8");

console.log(
  `${source.schemaVersion === 2 ? "v2 정규화" : "v2 변환"} 완료: ` +
  `${migratedBank.types.length}개 유형, ` +
  `${questions.length}개 문제, ` +
  `${questions.reduce((sum, question) => sum + question.options.length, 0)}개 옵션`
);
