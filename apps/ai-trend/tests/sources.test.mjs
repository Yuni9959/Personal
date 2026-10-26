import assert from "node:assert/strict";
import test from "node:test";
import { parseFeed, plain, sourceRows, SOURCES, WATCHLIST, parseAlphaXiv, parseGemini } from "../tools/sources.mjs";
import { rankCandidates, selectDiverse } from "../tools/selection.mjs";
import { publicAddress, publicText } from "../tools/public-fetch.mjs";
import { articleText, requirePrimaryEvidence } from "../tools/research.mjs";
import { filterCards } from "../js/model.js";

const now = new Date("2026-10-26T04:00:00Z");
const atom = (url, date, content = "AI tool") => `<entry><title>AI tool</title><published>${date}</published><updated>2026-10-26T03:00:00Z</updated><link rel='self' href='https://example.org/api'/><link rel='alternate' href='${url}'/><content type='html'>${content}</content></entry>`;
test("RSS·Atom은 실제 게시일·alternate 링크를 쓰고 갱신 시각으로 옛 글을 새로 만들지 않는다", () => {
  const feed = `<feed>${atom("https://example.org/new", "2026-10-25T03:00:00Z", "&lt;p&gt;AI &amp;amp; tools&lt;/p&gt;")}${atom("https://example.org/old", "2026-01-01T00:00:00Z")}${atom("javascript:alert(1)", "2026-10-25T03:00:00Z")}</feed>`;
  const rows = parseFeed(feed, "Example", now);
  assert.equal(rows.length, 1); assert.equal(rows[0].url, "https://example.org/new"); assert.equal(rows[0].description, "AI & tools");
  assert.equal(plain("&lt;script&gt;bad()&lt;/script&gt;safe"), "safe");
  const workspace = parseFeed(atom("http://workspaceupdates.googleblog.com/2026/10/test.html", "2026-10-25T03:00:00Z"), "Google Workspace Updates", now);
  assert.match(workspace[0].url, /^https:/);
  assert.equal(parseFeed(atom("http://example.org/a", "2026-10-25T03:00:00Z"), "Other", now).length, 0);
});
test("Techmeme는 매체 홈이 아닌 기사 링크를 택하고 발견 경로를 보존한다", () => {
  const feed = `<rss><item><title>AI launch</title><link>https://www.techmeme.com/261025/p1</link><pubDate>Sun, 25 Oct 2026 01:00:00 GMT</pubDate><description><![CDATA[<a href="https://publisher.example/">Publisher</a><b><a href="https://publisher.example/article">AI launch</a></b>]]></description></item></rss>`;
  const [row] = sourceRows(feed, SOURCES.find(s => s.name === "Techmeme"), now);
  assert.equal(row.url, "https://publisher.example/article"); assert.equal(row.discoveryUrl, "https://www.techmeme.com/261025/p1"); assert.equal(row.sourceKind, "reporting");
});
test("arXiv는 새 논문만, alphaXiv는 실제 arXiv 식별자와 유효한 관측 수만 채택한다", () => {
  const entry = atom("https://arxiv.org/abs/2610.12345", "2026-10-25T03:00:00Z").replace("</entry>", "<arxiv:announce_type>new</arxiv:announce_type></entry>");
  const config = SOURCES.find(s => s.name === "arXiv");
  assert.equal(sourceRows(`<feed>${entry}</feed>`, config, now)[0].channel, "research");
  assert.equal(sourceRows(`<feed>${entry.replace('>new<','>replace<')}</feed>`, config, now).length, 0);
  const item = { headline: "AI evaluation", url: "https://www.alphaxiv.org/abs/2610.12345", datePublished: "2026-10-25T03:00:00Z", interactionStatistic: [{ interactionType: { "@type": "ViewAction" }, userInteractionCount: 800 }] };
  const html = `<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "ItemList", name: "Trending Papers", itemListElement: [{ position: 1, item }, { position: 2, item: { ...item, url: "https://www.alphaxiv.org/abs/2610.fake-blog" } }] }] })}</script>`;
  const rows = parseAlphaXiv(html, now);
  assert.equal(rows.length, 1); assert.equal(rows[0].stats[0].value, 800); assert.equal(rows[0].paperRank, 1); assert.equal(rows[0].url, "https://arxiv.org/abs/2610.12345");
  assert.equal(parseGemini('<h2>2026.10.13</h2><h3>Old model</h3>', now).length, 0);
});
test("관심 신호와 공식 발표를 구분하고 연구가 소식 채널을 독점하지 않는다", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ category: "news", source: `source${i}`, sourceKind: "paper", channel: "research", title: `LLM paper ${i}`, url: `https://arxiv.org/abs/2610.1234${i}`, publishedAt: "2026-10-26T03:00:00Z" }));
  entries.push({ category: "news", source: "HN", sourceKind: "community", title: "AI tool", url: "https://example.org/new", publishedAt: "2026-10-25T03:00:00Z" });
  const ranked = rankCandidates(entries, { now });
  assert.ok(ranked.filter(r => r.sourceKind === "paper").every(r => r.selection.reasons.some(s => s.includes("동료심사"))));
  assert.equal(ranked.find(r => r.source === "HN").selection.badge, "커뮤니티 소식");
  const selected = selectDiverse(ranked);
  assert.equal(selected.filter(r => r.channel === "research").length, 2);
  assert.equal(filterCards(selected, { filter: "research" }).length, 2);
  assert.equal(filterCards(selected, { filter: "news" }).length, 1);
  assert.ok(WATCHLIST.every(s => s.enabled === false));
});
test("같은 논문이 여러 채널에서 발견돼도 alphaXiv 관측 출처와 HN 반응을 각각 보존한다", () => {
  const base = { category: "news", title: "LLM evaluation", url: "https://arxiv.org/abs/2610.12345", publishedAt: "2026-10-26T03:00:00Z" };
  const paper = { ...base, source: "alphaXiv", sourceKind: "paper", channel: "research", paperRank: 2, discoveryUrl: "https://www.alphaxiv.org/abs/2610.12345", stats: [{ label: "Views", value: 800 }] };
  const hn = { ...base, source: "Hacker News", sourceKind: "community", discoveryUrl: "https://news.ycombinator.com/item?id=1", hn: { points: 30, comments: 5, url: "https://news.ycombinator.com/item?id=1" } };
  for (const entries of [[paper, hn], [hn, paper], [paper, { ...base, source: "arXiv", sourceKind: "paper" }, hn]]) {
    const [row] = rankCandidates(entries, { now });
    assert.equal(row.source, "alphaXiv"); assert.equal(row.discoveryUrl, paper.discoveryUrl);
    assert.deepEqual(row.stats, paper.stats); assert.equal(row.hn.points, 30);
    assert.equal(row.selection.signals.find(s => s.label.startsWith("alphaXiv 공개")).url, paper.discoveryUrl);
  }
});
test("외부 원문과 리디렉션은 사설 주소를 거부하고 GitHub 토큰을 다른 호스트에 넘기지 않는다", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.1.1", "169.254.169.254", "100.64.1.1", "::1", "::ffff:127.0.0.1", "fc00::1"]) assert.equal(publicAddress(ip), false);
  const lookupImpl = async host => [{ address: host === "private.example" ? "127.0.0.1" : "93.184.216.34" }];
  let calls = 0;
  const fetchImpl = async (url, { headers }) => {
    calls++;
    if (url.hostname === "api.github.com") { assert.equal(headers.Authorization, "Bearer test-token"); return new Response(null, { status: 302, headers: { location: "https://publisher.example/article" } }); }
    assert.equal(headers.Authorization, undefined);
    return new Response("public content");
  };
  assert.equal((await publicText("https://api.github.com/example", { token: "test-token", lookupImpl, fetchImpl })).text, "public content");
  assert.equal(calls, 2);
  await assert.rejects(publicText("https://private.example/", { lookupImpl, fetchImpl }), /사설/);
  await assert.rejects(publicText("https://publisher.example/", { lookupImpl, fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://publisher.example/" } }) }), /HTTPS/);
  await assert.rejects(publicText("https://publisher.example/", { lookupImpl, fetchImpl: async () => new Response("too long"), maxBytes: 2 }), /크기/);
});
test("메뉴와 짧은 소개는 원문을 대신하지 못하며 보도·게시글을 제작자 증거로 바꾸지 않는다", () => {
  assert.equal(articleText(`<nav>${"Menu ".repeat(500)}</nav>`), "");
  const evidence = [{ kind: "reporting", text: "Original reporting. ".repeat(100) }];
  assert.throws(() => requirePrimaryEvidence(evidence, "paper"));
  assert.equal(requirePrimaryEvidence(evidence, "reporting"), evidence);
  assert.throws(() => requirePrimaryEvidence([{ kind: "community", text: "Comment ".repeat(1000) }], "community"));
});
