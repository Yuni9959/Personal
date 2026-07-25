import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertGradingInvariants,
  CONTENT_QUALITY_VERSION,
  enrichBank,
  TARGET_BANK_VERSION
} from "../tools/enrich-content-v2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(
  fs.readFileSync(
    path.join(here, "..", "data", "question-bank.json"),
    "utf8"
  )
);

test("콘텐츠 고도화 변환은 두 번 실행해도 결과가 바뀌지 않는다", () => {
  const rerun = enrichBank(structuredClone(bank));

  assert.deepEqual(rerun, bank);
  assert.doesNotThrow(() => assertGradingInvariants(bank, rerun));
});

test("652문제의 구조화 해설·2단계 힌트·난이도 프로필이 완성됐다", () => {
  assert.equal(bank.bankVersion, TARGET_BANK_VERSION);
  assert.equal(bank.contentQualityVersion, CONTENT_QUALITY_VERSION);
  assert.equal(bank.questions.length, 652);

  for (const question of bank.questions) {
    assert.equal(
      question.contentQualityVersion,
      CONTENT_QUALITY_VERSION,
      question.id
    );
    assert.deepEqual(
      Object.keys(question.explanation).sort(),
      ["application", "rule", "verification"],
      question.id
    );
    assert.equal(question.hints.length, 2, question.id);
    assert.ok(
      Number.isInteger(question.difficultyProfile.sourceDifficulty) &&
      question.difficultyProfile.sourceDifficulty >= 1 &&
      question.difficultyProfile.sourceDifficulty <= 8,
      question.id
    );
    assert.equal(
      question.difficultyProfile.overall,
      question.difficulty,
      question.id
    );
    assert.equal(
      question.options[question.answerIndex].id,
      question.correctOptionId,
      question.id
    );
  }
});

test("6개 인지 영역과 핵심·보조 점수 그룹이 문항까지 일관된다", () => {
  assert.equal(bank.cognitiveDomains.length, 6);
  const typeById = new Map(bank.types.map(type => [type.id, type]));
  assert.deepEqual(
    bank.types
      .filter(type => type.scoreGroup === "supplemental")
      .map(type => type.id),
    ["T23"]
  );
  assert.equal(typeById.has("T19"), false);
  assert.equal(typeById.has("T26"), true);

  for (const question of bank.questions) {
    const type = typeById.get(question.typeId);
    assert.equal(question.domainId, type.domainId, question.id);
    assert.equal(question.scoreGroup, type.scoreGroup, question.id);
  }
});

test("모든 오답 보기에 표준 오류 태그와 선택지 피드백이 있다", () => {
  const taxonomyIds = new Set(bank.errorTaxonomy.map(item => item.id));
  let wrongOptionCount = 0;

  for (const question of bank.questions) {
    for (const option of question.options) {
      if (option.id === question.correctOptionId) {
        assert.equal(option.errorTag, null, option.id);
        assert.equal(option.feedback, null, option.id);
        continue;
      }

      wrongOptionCount += 1;
      assert.ok(taxonomyIds.has(option.errorTag), option.id);
      assert.ok(option.feedback.trim().length >= 15, option.id);
    }
  }

  assert.equal(wrongOptionCount, 3618);
});
