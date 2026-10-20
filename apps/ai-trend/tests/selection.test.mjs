import assert from "node:assert/strict";
import test from "node:test";
import { canonicalUrl, rankCandidates, measuredGrowth, selectDiverse, nextMetricHistory, nextExposureHistory } from "../tools/selection.mjs";
const now = new Date("2026-10-20T06:00:00Z");
const repo = (name, extra = {}) => ({ category: "project", title: `${name}/ai`, name: `${name}/ai`, source: "GitHub", description: "AI project with detailed implementation", url: `https://github.com/${name}/ai`, stars: 100, publishedAt: "2026-10-10T00:00:00Z", pushedAt: "2026-10-20T00:00:00Z", ...extra });
test("누적 별이 많은 정체 프로젝트보다 관측된 단기 증가를 우선한다", () => {
  const old = repo("big", { stars: 100000 }), emerging = repo("new", { stars: 1000 });
  const previous = { metricHistory: { [old.url]: [{ at: "2026-10-20T00:00:00Z", stars: 100000 }], [emerging.url]: [{ at: "2026-10-20T00:00:00Z", stars: 400 }] } };
  const ranked = rankCandidates([old, emerging], { now, previous });
  assert.equal(ranked[0].title, emerging.title); assert.equal(ranked[0].selection.growth.perHour, 100);
  assert.equal(ranked[1].selection.components.totalAttention, 4);
});
test("성장률은 유효한 1~48시간 관측 구간만 사용하고 첫 관측·감소·롤링 다운로드를 부풀리지 않는다", () => {
  const card = repo("sample");
  for (const at of ["2026-10-20T05:59:00Z", "2026-10-17T00:00:00Z", "2026-10-21T00:00:00Z", "bad"]) assert.equal(measuredGrowth(card, { metricHistory: { [card.url]: [{ at, stars: 0 }] } }, now), null);
  assert.equal(measuredGrowth(card, null, now), null);
  assert.equal(measuredGrowth(card, { metricHistory: { [card.url]: [{ at: "2026-10-20T00:00:00Z", stars: 200 }] } }, now), null);
  const model = { ...card, category: "model", stars: undefined, likes: 20, downloads: 100000 };
  const ranked = rankCandidates([model], { now, previous: { metricHistory: { [card.url]: [{ at: "2026-10-20T00:00:00Z", likes: 20, downloads: 100 }] } } });
  assert.equal(ranked[0].selection.growth.delta, 0); assert.equal(ranked[0].selection.components.measuredVelocity, 0);
});
test("동일 URL의 추적 파라미터·GitHub 대소문자를 합치고 중복 검색을 외부 검증으로 세지 않는다", () => {
  assert.equal(canonicalUrl("https://github.com/Owner/Repo/?utm_source=feed#readme"), "https://github.com/owner/repo");
  assert.equal(canonicalUrl("javascript:alert(1)"), null);
  const a = repo("Owner", { dailyStars: 100, discovery: ["github-trending"] });
  const b = { ...a, url: a.url.toLowerCase() + "?utm_medium=rss", dailyStars: null, discovery: ["github-topic:llm"] };
  const ranked = rankCandidates([a, b], { now }); assert.equal(ranked.length, 1);
  assert.equal(ranked[0].dailyStars, 100); assert.equal(ranked[0].selection.independentCommunity, false);
  const confirmed = rankCandidates([{ ...a, hn: { points: 60, comments: 10, url: "https://news.ycombinator.com/item?id=123" } }], { now });
  assert.equal(confirmed[0].selection.independentCommunity, true);
});
test("반복 소개는 감점하고 새로고침만으로 관측 구간·소개 시각을 밀어내지 않는다", () => {
  const a = repo("repeat"), b = repo("unseen");
  const previous = { cards: [a], generatedAt: "2026-10-20T00:00:00Z", exposureHistory: { [a.url]: { lastFeaturedAt: "2026-10-20T00:00:00Z" } } };
  const ranked = rankCandidates([a, b], { now, previous }); assert.equal(ranked[0].title, b.title);
  const baseline = { at: "2026-10-20T05:50:00Z", stars: 50 };
  const history = nextMetricHistory(ranked, { metricHistory: { [a.url]: [baseline] } }, now);
  assert.deepEqual(history[a.url], [baseline]);
  const exposure = nextExposureHistory([a], previous, new Date("2026-10-20T00:10:00Z"));
  assert.equal(exposure[a.url].lastFeaturedAt, previous.generatedAt);
  const news = { category: "news", title: "Old release", source: "Official", url: "https://example.com/old", publishedAt: "2026-10-14T06:00:00Z" };
  assert.equal(selectDiverse(rankCandidates([news], { now, previous: { cards: [news], generatedAt: "2026-10-20T05:00:00Z" } })).length, 0);
});
test("분야 쏠림을 완화하고 같은 제작자·뉴스 매체가 발행본을 독점하지 않는다", () => {
  const rows = [repo("one", { title: "one/agent", description: "AI coding agent", dailyStars: 1000 }), repo("two", { title: "two/agent", description: "AI coding agent", dailyStars: 950 }), repo("three", { title: "three/agent", description: "AI coding agent", dailyStars: 900 }), repo("voice", { description: "AI text-to-speech", dailyStars: 800 })];
  const picked = selectDiverse(rankCandidates(rows, { now }), { limits: { project: 3 } });
  assert.ok(picked.some(c => c.name === "voice/ai"));
  const news = Array.from({ length: 5 }, (_, i) => ({ category: "news", title: `AI release ${i}`, source: "One publisher", url: `https://example.com/${i}`, publishedAt: "2026-10-20T05:00:00Z" }));
  assert.equal(selectDiverse(rankCandidates(news, { now })).length, 2);
  const sameOwner = [repo("same"), repo("same", { url: "https://github.com/same/second" })];
  assert.equal(selectDiverse(rankCandidates(sameOwner, { now })).length, 1);
});
test("비공개·아카이브·포크·미래·오래된 뉴스는 후보에서 제외한다", () => {
  assert.equal(rankCandidates([repo("private", { private: true }), repo("archived", { archived: true }), repo("fork", { fork: true }), repo("future", { publishedAt: "2026-10-21T00:00:00Z" }), { ...repo("oldnews"), category: "news", publishedAt: "2026-10-01T00:00:00Z" }], { now }).length, 0);
});
