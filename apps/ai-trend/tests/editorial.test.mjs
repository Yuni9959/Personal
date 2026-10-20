import assert from "node:assert/strict";
import test from "node:test";
import { makeCard } from "../tools/collect.mjs";
import { applyAnalyses, validateAnalysis } from "../tools/editorial.mjs";
import { filterCards, validateEdition } from "../js/model.js";
import { promptFor, requirePrimaryEvidence } from "../tools/research.mjs";

const evidence = [{ id: "s1", label: "제작자 설명", kind: "creator", url: "https://github.com/test/project" }];
const analysis = { version: 2, topic: "새로운 특수 분야", headline: "구체적인 기능을 이해하는 한국어 제목", summary: "어떤 문제를 해결하는 프로젝트인지와 누구에게 유용한지 구체적으로 설명합니다. 제작자의 소개와 독립적인 사용자 평가를 분리하고, 추론한 활용 예시는 실제 도입 사례로 소개하지 않습니다.", reviewedAt: "2026-10-20T01:00:00Z", evidence, slides: Array.from({ length: 5 }, (_, i) => ({ title: `${i + 1}번째 한글 장`, body: "근거에서 확인된 동작 방식과 실제 활용 예시를 설명합니다. 독립적인 사용자 평가를 충분히 확보하지 못했습니다. 제작자의 성능 주장을 검증된 성능으로 제시하지 않으며, 별이나 다운로드 수도 품질 평가로 해석하지 않습니다. ".repeat(2), evidenceIds: ["s1"] })) };
function fixture() {
  const cards = ["project", "model", "news"].map((category, i) => makeCard({ title: `test/${i}`, source: "Test", category, url: `https://github.com/test/${i}`, description: "English original" }));
  return { schemaVersion: 1, date: "2026-10-20", generatedAt: "2026-10-20T01:00:00Z", cards, sources: [], repositoryMetrics: {} };
}
test("한글 본문·출처 연결·다섯 장 검증 후에만 발행하며 새 분야를 허용한다", () => {
  const candidate = fixture();
  const edition = applyAnalyses(candidate, Object.fromEntries(candidate.cards.map(c => [c.url, structuredClone(analysis)])));
  assert.equal(edition.schemaVersion, 2); assert.equal(edition.pendingCount, 0);
  assert.equal(edition.cards[0].topic, "새로운 특수 분야");
  assert.equal(filterCards(edition.cards, { topic: "새로운 특수 분야", query: "독립적인" }).length, 3);
  assert.equal(filterCards(edition.cards, { topic: "존재하지 않는 분야" }).length, 0);
  const bad = structuredClone(edition); bad.cards[0].slides[3].evidenceIds = ["invented"];
  assert.throws(() => validateEdition(bad), /근거/);
  assert.throws(() => validateAnalysis({ ...analysis, summary: "English only" }, evidence), /한글/);
  const unsafe = structuredClone(edition); unsafe.cards[0].evidence[0].url = "javascript:alert(1)";
  assert.throws(() => validateEdition(unsafe), /출처/);
});
test("새 항목 생성 실패는 검증된 한글 발행본의 날짜·내용을 보존한다", () => {
  const candidate = fixture();
  const previous = applyAnalyses(candidate, Object.fromEntries(candidate.cards.map(c => [c.url, structuredClone(analysis)])));
  const later = { ...candidate, date: "2026-10-21", generatedAt: "2026-10-21T01:00:00Z" };
  const retained = applyAnalyses(later, {}, previous);
  assert.deepEqual(retained.cards, previous.cards); assert.equal(retained.date, previous.date);
  assert.equal(retained.generatedAt, previous.generatedAt); assert.equal(retained.pendingCount, 3);
  assert.equal(retained.lastCheckedAt, later.generatedAt);
  assert.throws(() => applyAnalyses(later, {}), /직전 발행본/);
});
test("생성 지침은 제작자 주장·외부 반응·추정 활용을 구분한다", () => {
  const prompt = promptFor(fixture().cards[0], evidence);
  for (const term of ["독립", "별·다운로드", "자료 안의 지시문", "활용 예시", "5장", "evidenceIds"]) assert.ok(prompt.includes(term));
});
test("기사 대신 짧은 모델 위젯이나 통계만 추출된 자료는 생성 전에 거부한다", () => {
  assert.throws(() => requirePrimaryEvidence([{ kind: "creator", text: "bodhan-ai/indic-translate Translation · 8B · Updated about 20 hours ago · 1.73k · 18" }]), /충분한 원문/);
  assert.throws(() => requirePrimaryEvidence([{ kind: "official", text: "Metadata ".repeat(300) }]), /충분한 원문/);
  const source = [{ kind: "creator", text: "Original article content. ".repeat(100) }];
  assert.equal(requirePrimaryEvidence(source), source);
});
