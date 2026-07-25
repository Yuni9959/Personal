import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradingFingerprint } from "./bank-utils.mjs";
import { renderAnswerKey } from "./generate-answer-key.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mensaRoot = path.resolve(here, "..");
const dataPath = path.join(mensaRoot, "data", "question-bank.json");
const answerKeyPath = path.join(mensaRoot, "data", "answer-key.csv");
const bank = JSON.parse(fs.readFileSync(dataPath, "utf8"));

if (bank.schemaVersion !== 2) {
  throw new Error(`schemaVersion 2만 동기화할 수 있습니다: ${bank.schemaVersion}`);
}

const synced = {
  ...bank,
  questions: bank.questions.map(question => ({
    ...question,
    gradingFingerprint: gradingFingerprint(question)
  }))
};

fs.writeFileSync(dataPath, `${JSON.stringify(synced, null, 2)}\n`, "utf8");
fs.writeFileSync(answerKeyPath, renderAnswerKey(synced), "utf8");

console.log(
  `문제은행 동기화 완료: ${synced.questions.length}개 문제, ` +
  `${synced.questions.reduce((sum, question) => sum + question.options.length, 0)}개 옵션`
);
