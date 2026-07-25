import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvCell } from "./bank-utils.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mensaRoot = path.resolve(here, "..");
const dataPath = path.join(mensaRoot, "data", "question-bank.json");
const outputPath = path.join(mensaRoot, "data", "answer-key.csv");

function explanationText(explanation) {
  if (typeof explanation === "string") return explanation;
  if (!explanation || typeof explanation !== "object") return "";
  return [
    explanation.rule && `규칙: ${explanation.rule}`,
    explanation.application && `적용: ${explanation.application}`,
    explanation.verification && `검산: ${explanation.verification}`
  ].filter(Boolean).join(" ");
}

export function renderAnswerKey(bank) {
  const header = [
    "id",
    "content_version",
    "type_id",
    "type_title",
    "difficulty",
    "correct_option_id",
    "answer_option",
    "grading_fingerprint",
    "explanation"
  ];

  const rows = bank.questions.map(question => {
    const answerIndex = question.options.findIndex(
      option => option.id === question.correctOptionId
    );

    if (answerIndex < 0) {
      throw new Error(`정답 옵션 ID를 찾을 수 없습니다: ${question.id}`);
    }

    return [
      question.id,
      question.contentVersion,
      question.typeId,
      question.typeTitle,
      question.difficulty,
      question.correctOptionId,
      answerIndex + 1,
      question.gradingFingerprint,
      explanationText(question.explanation)
    ];
  });

  return [header, ...rows]
    .map(row => row.map(csvCell).join(","))
    .join("\n") + "\n";
}

function main() {
  const bank = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const generated = renderAnswerKey(bank);
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    const current = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, "utf8")
      : "";

    if (current !== generated) {
      console.error("answer-key.csv가 question-bank.json과 일치하지 않습니다.");
      process.exit(1);
    }

    console.log(`CSV 동기화 확인: ${bank.questions.length}개 정답`);
  } else {
    fs.writeFileSync(outputPath, generated, "utf8");
    console.log(`CSV 생성 완료: ${bank.questions.length}개 정답`);
  }
}

if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
