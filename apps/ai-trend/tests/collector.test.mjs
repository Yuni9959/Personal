import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildEdition, collect, dayKst, makeCard, parseFeed, parseTrending, plain, publish, safeUrl } from "../tools/collect.mjs";
import { filterCards, isOldEdition, validateEdition } from "../js/model.js";

const NOW = new Date("2026-10-19T23:17:00Z");
const items = [
  { title: "test/agent", name: "test/agent", category: "project", source: "GitHub", url: "https://github.com/test/agent", description: "A coding agent", stars: 200, dailyStars: 30 },
  { title: "New model", category: "model", source: "Hugging Face", url: "https://huggingface.co/test/model", description: "An open model" },
  { title: "AI release", category: "news", source: "Official", url: "https://example.com/ai", description: "Release details", publishedAt: "2026-10-19T12:00:00Z" }
];
test("RSS 날짜와 URL을 검증하고 미래·오래된 항목·script URL을 제외한다", () => {
  const entry = (link, date) => `<item><title><![CDATA[AI &amp; code]]></title><link>${link}</link><description><![CDATA[<p>New <b>model</b></p>]]></description><pubDate>${date}</pubDate></item>`;
  const xml = entry("https://example.com/new", "Mon, 19 Oct 2026 12:00:00 GMT") + entry("javascript:alert(1)", "Mon, 19 Oct 2026 12:00:00 GMT") + entry("https://example.com/old", "Mon, 01 Jun 2026 12:00:00 GMT") + entry("https://example.com/future", "Wed, 21 Oct 2026 12:00:00 GMT");
  const rows = parseFeed(xml, "Official", NOW);
  assert.equal(rows.length, 1); assert.equal(rows[0].title, "AI & code"); assert.equal(rows[0].description, "New model");
  assert.equal(safeUrl("http://example.com"), null); assert.equal(plain("<script>bad()</script><p>ok</p>"), "ok");
});
test("GitHub Trending에서 당일 성장량을 누적 별과 분리하고 AI만 고른다", () => {
  const html = `<article class="Box-row"><h2><a href="/test/agent">test / agent</a></h2><p>AI coding agent</p><span>1,234 stars today</span></article><article class="Box-row"><h2><a href="/test/calendar">calendar</a></h2><p>A calendar tool</p></article>`;
  assert.deepEqual(parseTrending(html), [{ name: "test/agent", description: "AI coding agent", dailyStars: 1234 }]);
});
test("중복 원문을 제거하고 첫 수집의 성장량을 만들지 않는다", () => {
  const edition = buildEdition([...items, items[0]], [], { now: NOW });
  assert.equal(edition.date, "2026-10-20"); assert.equal(edition.cards.length, 3);
  assert.match(edition.cards[0].slides[1].body, /30개/);
  const first = makeCard({ ...items[0], dailyStars: null }, NOW);
  assert.match(first.slides[1].body, /아직 측정하지 않았/);
  const next = buildEdition(items.map(item => ({ ...item, dailyStars: null })), [], { now: NOW, previous: { repositoryMetrics: { "test/agent": 140 } } });
  assert.match(next.cards[0].slides[1].body, /\+60개/);
  assert.equal(dayKst(new Date("2026-10-19T15:00:00Z")), "2026-10-20");
});
test("모든 수집 실패 시 발행을 거부하여 직전 발행본을 보존한다", async () => {
  await assert.rejects(collect({ now: NOW, fetchImpl: async () => { throw new Error("offline"); } }), /직전 발행본을 보존/);
  assert.throws(() => buildEdition(items.slice(0, 1), [], { now: NOW }), /충분한 최신 정보/);
});
test("UI는 검색·분류·저장을 결합하고 위험 URL과 중복 카드를 거부한다", () => {
  const edition = validateEdition(buildEdition(items, [], { now: NOW }));
  const saved = new Set([edition.cards[0].id]);
  assert.equal(filterCards(edition.cards, { filter: "saved", query: "AGENT", saved }).length, 1);
  assert.equal(filterCards(edition.cards, { filter: "model", query: "agent" }).length, 0);
  const bad = structuredClone(edition); bad.cards[0].url = "javascript:alert(1)";
  assert.throws(() => validateEdition(bad));
  const duplicate = structuredClone(edition); duplicate.cards.push(duplicate.cards[0]); assert.throws(() => validateEdition(duplicate));
  assert.equal(isOldEdition(edition, new Date("2026-10-20T16:00:00Z")), true);
});
test("발행 파일과 날짜 색인을 실제로 기록하고 30일만 보존한다", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-trend-test-"));
  try {
    const dir = path.join(root, "data/archive"); await fs.mkdir(dir, { recursive: true });
    for (let i = 1; i <= 31; i++) await fs.writeFile(path.join(dir, `2026-08-${String(i).padStart(2, "0")}.json`), "{}");
    const edition = buildEdition(items, [], { now: NOW }); await publish(edition, root);
    const index = JSON.parse(await fs.readFile(path.join(root, "data/index.json")));
    assert.equal(index.dates.length, 30); assert.equal(index.latest, edition.date);
    assert.equal((await fs.readdir(dir)).length, 30);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "data/latest.json"))), edition);
  } finally { await fs.rm(root, { recursive: true }); }
});
