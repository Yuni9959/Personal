import assert from "node:assert/strict";
import test from "node:test";
import handler, { loadMarket } from "../../../api/market.js";
import { fetchMarketSnapshot, MARKET_API_URL, parseYahooChart } from "../js/market-provider.js";

const NOW = new Date("2026-08-13T00:10:00Z");
function fixture() {
  const timestamp = Array.from({ length: 25 }, (_, i) => Date.parse("2026-08-12T22:00:00Z") / 1000 + i * 300);
  const open = timestamp.map((_, i) => 30000 + i * 0.25);
  return { chart: { error: null, result: [{ meta: {
    symbol: "MNQ=F", dataGranularity: "5m", instrumentType: "FUTURE", currency: "USD", exchangeName: "CME", exchangeTimezoneName: "America/Chicago",
    regularMarketDayHigh: 30009, regularMarketDayLow: 29998, regularMarketPrice: 30007, regularMarketTime: timestamp.at(-1)
  }, timestamp, indicators: { quote: [{ open, high: open.map(x => x + 3), low: open.map(x => x - 2), close: open.map(x => x + 1) }] } }] } };
}

function gapFixture() {
  const payload = fixture();
  const result = payload.chart.result[0];
  result.meta.regularMarketDayLow = 29990; // Real failure: summary differs by > 2 ticks.
  for (const field of ["open", "high", "low", "close"]) result.indicators.quote[0][field][4] = null;
  return payload;
}
function rangeFixture() {
  return { totalCount: 1, data: [{ s: "CME_MINI:MNQ1!", d: [
    "MNQ1!", "Micro E-mini Nasdaq-100 Index Futures", 30007, 30000, 30009, 29998,
    Date.parse("2026-08-12T22:00:00Z") / 1000, "delayed_streaming_600", "CME_MINI", "USD", "futures", 100, 25
  ] }] };
}

test("실제 장애 회귀: 결손 봉과 다른 Yahoo 저가는 독립 MNQ 세션 범위가 있을 때만 복구한다", async () => {
  const calls = [];
  const payload = await loadMarket(async (url, options) => {
    calls.push(String(url));
    if (String(url).includes("scanner.tradingview.com")) {
      assert.equal(options.method, "POST"); assert.equal(options.cache, "no-store");
      assert.deepEqual(JSON.parse(options.body).symbols.tickers, ["CME_MINI:MNQ1!"]);
      return Response.json(rangeFixture());
    }
    return Response.json(gapFixture());
  }, NOW);
  assert.equal(calls.length, 2);
  const snapshot = await fetchMarketSnapshot(async () => Response.json(payload), NOW);
  assert.equal(snapshot.market.low, 29998); assert.equal(snapshot.market.high, 30009);
  assert.equal(snapshot.market.open, 30000); assert.equal(snapshot.market.current, 30007);
  assert.equal(snapshot.provider.missingInteriorBucketCount, 1);
  assert.equal(snapshot.provider.sessionRangeFromCompleteBars, false);
  assert.equal(snapshot.provider.sessionRangeCorroboration.provider, "TradingView CME_MINI:MNQ1!");
  assert.equal(snapshot.market.latestBarAt, "2026-08-13T00:00:00.000Z");
  assert.notEqual(snapshot.market.latestBarAt, snapshot.generatedAt);
});

test("독립 범위 증거가 달라도 종목·세션·틱·원천시각·결손 검증은 생략하지 않는다", () => {
  const make = () => ({ ...gapFixture(), rangeEvidence: {
    provider: "tradingview-scanner", fetchedAt: NOW.toISOString(), payload: rangeFixture()
  } });
  const mutate = [
    p => { p.rangeEvidence.provider = "unknown"; },
    p => { p.rangeEvidence.fetchedAt = "2026-08-12T00:00:00Z"; },
    p => { p.rangeEvidence.payload.data[0].s = "CME_MINI:NQ1!"; },
    ...[[0, "NQ1!"], [3, 30001], [4, 30012], [5, 29990], [6, 1], [7, "streaming"],
      [8, "OTHER"], [9, "EUR"], [10, "stock"], [11, 1], [12, 1]].map(([i, value]) =>
        p => { p.rangeEvidence.payload.data[0].d[i] = value; }),
    p => { p.chart.result[0].meta.regularMarketPrice += 0.25; },
    p => { p.chart.result[0].meta.regularMarketTime += 1; },
    p => { for (const field of ["open", "high", "low", "close"]) p.chart.result[0].indicators.quote[0][field][5] = null; }
  ];
  for (const change of mutate) {
    const payload = make(); change(payload);
    assert.throws(() => parseYahooChart(payload, "MNQ=F", NOW, { sessionBarsAuthoritative: true }));
  }
  assert.throws(() => parseYahooChart(gapFixture(), "MNQ=F", NOW, { sessionBarsAuthoritative: true }));
});

test("서버 지역별 첫 틱 차이는 2틱 이내 교차검증 후 독립 공급자의 실제 시가를 사용한다", () => {
  const payload = gapFixture();
  const range = rangeFixture(); range.data[0].d[3] = 30000.25;
  payload.rangeEvidence = { provider: "tradingview-scanner", fetchedAt: NOW.toISOString(), payload: range };
  const snapshot = parseYahooChart(payload, "MNQ=F", NOW, { sessionBarsAuthoritative: true });
  assert.equal(snapshot.market.open, 30000.25);
  assert.equal(snapshot.provider.sessionRangeCorroboration.open, 30000.25);
  assert.equal(snapshot.market.latestBarAt, "2026-08-13T00:00:00.000Z");
});

test("독립 출처 장애나 잘못된 범위는 성공 응답으로 위장하지 않는다", async () => {
  await assert.rejects(loadMarket(async url => String(url).includes("scanner.tradingview.com")
    ? new Response("unavailable", { status: 503 }) : Response.json(gapFixture()), NOW), /independent range HTTP 503/);
  await assert.rejects(loadMarket(async url => {
    const range = rangeFixture(); range.data[0].d[5] -= 20;
    return Response.json(String(url).includes("scanner.tradingview.com") ? range : gapFixture());
  }, NOW), /독립 세션 시가/);
});
test("완전한 CME 세션봉은 Yahoo 일중 요약과 범위가 달라도 자체 H/L을 계산한다", () => {
  const payload = fixture(); payload.chart.result[0].meta.regularMarketDayLow = 29990;
  assert.throws(() => parseYahooChart(payload, "MNQ=F", NOW), /일치하지 않/);
  const snapshot = parseYahooChart(payload, "MNQ=F", NOW, { sessionBarsAuthoritative: true });
  assert.equal(snapshot.market.low, 29998); assert.equal(snapshot.market.open, 30000);
  assert.equal(snapshot.provider.sessionRangeFromCompleteBars, true);
  assert.deepEqual(snapshot.provider.regularMarketFieldsVerified, ["current", "time"]);
  assert.ok(snapshot.market.atr5m14 > 0);
});
test("결손 봉이 있거나 현재가·시각이 불일치하면 독립 세션 계산도 거부한다", () => {
  const gap = fixture(); const x = gap.chart.result[0]; x.meta.regularMarketDayLow = 29990;
  for (const field of ["open", "high", "low", "close"]) x.indicators.quote[0][field][4] = null;
  assert.throws(() => parseYahooChart(gap, "MNQ=F", NOW, { sessionBarsAuthoritative: true }));
  for (const key of ["regularMarketPrice", "regularMarketTime"]) {
    const bad = fixture(); bad.chart.result[0].meta[key] += 1;
    assert.throws(() => parseYahooChart(bad, "MNQ=F", NOW, { sessionBarsAuthoritative: true }));
  }
});
test("전용 API는 원천 첫 호스트 장애 시 두 번째로 전환하고 브라우저가 원시 OHLC를 다시 검증한다", async () => {
  const calls = [];
  const payload = await loadMarket(async url => { calls.push(String(url)); return calls.length === 1 ? new Response("blocked", { status: 429 }) : Response.json(fixture()); }, NOW);
  assert.equal(calls.length, 2); assert.equal(payload.service.sourceHost, "query2.finance.yahoo.com");
  const snapshot = await fetchMarketSnapshot(async (url, options) => {
    assert.ok(String(url).startsWith(MARKET_API_URL)); assert.equal(options.cache, "no-store"); return Response.json(payload);
  }, NOW);
  assert.equal(snapshot.provider.transport, "Personal Tap direct server API"); assert.equal(snapshot.market.current, 30007);
});
test("두 원천이 모두 실패하면 이전 시세를 성공으로 반환하지 않는다", async () => {
  await assert.rejects(loadMarket(async () => new Response("error", { status: 503 }), NOW), /query1.*query2/);
});
test("보조 중계 429 대기 중에도 전용 API를 확인하고 보조 요청은 보내지 않는다", async () => {
  let calls = 0;
  const success = await fetchMarketSnapshot(async () => { calls++; return Response.json(fixture()); }, NOW, { readerBackoffRemainingMs: 120000 });
  assert.equal(calls, 1); assert.equal(success.market.current, 30007);
  calls = 0;
  await assert.rejects(fetchMarketSnapshot(async () => { calls++; return Response.json({}); }, NOW, { readerBackoffRemainingMs: 120000 }), /429 대기/);
  assert.equal(calls, 1);
});
test("API의 Origin·메서드를 제한하고 CDN/브라우저 시세 캐시를 차단한다", async () => {
  function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } }; }
  const blocked = response(); await handler({ method: "GET", headers: { origin: "https://evil.example" } }, blocked);
  assert.equal(blocked.code, 403); assert.equal(blocked.headers["Vercel-CDN-Cache-Control"], "no-store");
  const preflight = response(); await handler({ method: "OPTIONS", headers: { origin: "https://yuni9959.github.io" } }, preflight);
  assert.equal(preflight.code, 204); assert.equal(preflight.headers["Access-Control-Allow-Origin"], "https://yuni9959.github.io");
});
