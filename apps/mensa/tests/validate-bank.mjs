import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, "..", "data", "question-bank.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const { types, questions } = data;

const errors = [];
const ids = new Set();

if (types.length !== 25) errors.push(`유형 수가 25가 아닙니다: ${types.length}`);
if (questions.length !== 125) errors.push(`문제 수가 125가 아닙니다: ${questions.length}`);

for (const question of questions) {
  if (ids.has(question.id)) errors.push(`중복 ID: ${question.id}`);
  ids.add(question.id);

  if (!Number.isInteger(question.answerIndex) ||
      question.answerIndex < 0 ||
      question.answerIndex >= question.options.length) {
    errors.push(`정답 인덱스 오류: ${question.id}`);
  }

  if (question.options.length < 6) {
    errors.push(`보기 수 부족: ${question.id} (${question.options.length})`);
  }

  const signatures = question.options.map(option =>
    JSON.stringify({ text: option.text ?? null, svg: option.svg ?? null, suffix: option.suffix ?? null })
  );
  if (new Set(signatures).size !== signatures.length) {
    errors.push(`중복 보기: ${question.id}`);
  }

  if (!question.stimulusSvg?.startsWith("<svg")) {
    errors.push(`자극 SVG 누락: ${question.id}`);
  }
}

for (const type of types) {
  const count = questions.filter(question => question.typeId === type.id).length;
  if (count !== 5) errors.push(`${type.id} 문제 수가 5가 아닙니다: ${count}`);
}

if (errors.length) {
  console.error("검증 실패");
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`검증 성공: ${types.length}개 유형, ${questions.length}개 문제, 모든 정답 인덱스와 보기가 정상입니다.`);
