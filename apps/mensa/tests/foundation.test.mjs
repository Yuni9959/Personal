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
  "7e1c0b077afdb4cfaa4719f494921365e52a1ae78c639d4c0c58d43897425222";
const activeBaseline = baseline.questions.filter(
  question => question.typeId !== "T19"
);

test("v2 활성 문제은행의 652문항·4270보기 ID가 안정적이다", () => {
  assert.equal(bank.schemaVersion, 2);
  assert.equal(bank.types.length, 25);
  assert.equal(bank.questions.length, 652);
  assert.equal(
    bank.questions.reduce((sum, question) => sum + question.options.length, 0),
    4270
  );
  assert.equal(
    new Set(bank.questions.flatMap(question =>
      question.options.map(option => option.id)
    )).size,
    4270
  );
  assert.equal(
    bank.questions.filter(question => "answerIndex" in question).length,
    652
  );
  assert.equal(bank.questions.some(question => question.typeId === "T19"), false);
  assert.equal(bank.questions.filter(
    question => question.provenance.sourceId === "foundation-v1"
  ).length, 120);
  assert.equal(bank.questions.filter(
    question => question.provenance.sourceId === "advanced-v1"
  ).length, 232);
  assert.equal(bank.questions.filter(
    question => question.provenance.sourceId === "mkat-original-300-v1"
  ).length, 300);
});

test("T19를 제외한 Foundation 120문항의 SVG·보기·정답은 동일하다", () => {
  const foundationQuestions = bank.questions.filter(
    question => question.provenance.sourceId === "foundation-v1"
  );
  assert.equal(activeBaseline.length, 120);
  assert.equal(foundationQuestions.length, activeBaseline.length);

  for (const legacy of activeBaseline) {
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
  assert.equal(
    bank.questions.some(question => question.id.startsWith("T19-")),
    false
  );
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

test("활성 Foundation 120문제의 채점 계약 전체가 유지된다", () => {
  const gradingSet = bank.questions
    .filter(question => question.provenance.sourceId === "foundation-v1")
    .map(question => `${question.id}:${question.gradingFingerprint}`)
    .join("\n");

  assert.equal(sha256(gradingSet), FOUNDATION_GRADING_SET_SHA256);
});

test("answer-key.csv는 JSON에서 완전히 재생성된다", () => {
  const csvPath = path.join(mensaRoot, "data", "answer-key.csv");
  assert.equal(fs.readFileSync(csvPath, "utf8"), renderAnswerKey(bank));
});
