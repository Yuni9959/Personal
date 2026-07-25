import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  gradingFingerprint,
  optionSignature,
  sha256
} from "../tools/bank-utils.mjs";
import { renderAnswerKey } from "../tools/generate-answer-key.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mensaRoot = path.resolve(here, "..");
const bank = JSON.parse(
  fs.readFileSync(path.join(mensaRoot, "data", "question-bank.json"), "utf8")
);
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(here, "fixtures", "question-bank-v1-baseline.json"),
    "utf8"
  )
);
const FOUNDATION_GRADING_SET_SHA256 =
  "ba9e76f8b9fb2fba64bf12e6ec5bd8e6804c6f6de8e1d7fb1f014792fe4368d3";

test("v2 문제은행의 전체 수량과 ID가 안정적이다", () => {
  assert.equal(bank.schemaVersion, 2);
  assert.equal(bank.types.length, 25);
  assert.equal(bank.questions.length, 125);
  assert.equal(
    bank.questions.reduce((sum, question) => sum + question.options.length, 0),
    830
  );
  assert.equal(
    new Set(bank.questions.flatMap(question =>
      question.options.map(option => option.id)
    )).size,
    830
  );
  assert.equal(bank.questions.filter(question => "answerIndex" in question).length, 0);
});

test("v1에서 v2로 바뀌어도 모든 SVG와 보기 콘텐츠가 동일하다", () => {
  assert.equal(bank.types.length, baseline.typeCount);
  assert.equal(bank.questions.length, baseline.questionCount);

  for (const legacy of baseline.questions) {
    const question = bank.questions.find(item => item.id === legacy.id);
    assert.ok(question, `문제 누락: ${legacy.id}`);
    assert.equal(question.typeId, legacy.typeId);
    assert.equal(question.options.length, legacy.optionCount);
    assert.equal(sha256(question.stimulusSvg), legacy.stimulusSignature);
    assert.deepEqual(
      question.options.map(optionSignature),
      legacy.optionSignatures,
      `보기 콘텐츠 변경: ${legacy.id}`
    );

    const correctOption = question.options.find(
      option => option.id === question.correctOptionId
    );
    assert.ok(correctOption, `정답 옵션 누락: ${legacy.id}`);
    assert.equal(
      optionSignature(correctOption),
      legacy.correctOptionSignature,
      `정답 의미 변경: ${legacy.id}`
    );
    assert.equal(
      question.correctOptionId,
      question.options[legacy.answerIndex].id,
      `정답 위치 변환 오류: ${legacy.id}`
    );
  }
});

test("저장된 채점 fingerprint를 다시 계산할 수 있다", () => {
  for (const question of bank.questions) {
    assert.equal(
      question.gradingFingerprint,
      gradingFingerprint(question),
      question.id
    );
  }
});

test("Foundation의 125문제 채점 계약 전체가 유지된다", () => {
  const gradingSet = bank.questions
    .map(question => `${question.id}:${question.gradingFingerprint}`)
    .join("\n");

  assert.equal(sha256(gradingSet), FOUNDATION_GRADING_SET_SHA256);
});

test("answer-key.csv는 JSON에서 완전히 재생성된다", () => {
  const csvPath = path.join(mensaRoot, "data", "answer-key.csv");
  assert.equal(fs.readFileSync(csvPath, "utf8"), renderAnswerKey(bank));
});
