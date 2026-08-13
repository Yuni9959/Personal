import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cmeEquitySessionFor, fetchYahooSnapshot, parseYahooChart } from "../js/market-provider.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function payload(symbol = "MNQ=F") {
  const start = Date.parse("2026-08-12T21:50:00Z") / 1000;
  const timestamp = Array.from({ length: 22 }, (_, index) => start + index * 300);
  const values = timestamp.map((_, index) => 30000 + index);
  return {
    chart: {
      error: null,
      result: [{
        meta: { symbol, dataGranularity: "5m" }, timestamp,
        indicators: { quote: [{
          open: values,
          high: values.map(value => value + 3),
          low: values.map(value => value - 2),
          close: values.map(value => value + 1)
        }] }
      }]
    }
  };
}

test("Chicago 세션 경계를 서머타임 포함 UTC로 변환한다", () => {
  const summer = cmeEquitySessionFor(new Date("2026-08-13T12:00:00Z"));
  assert.equal(summer.start.toISOString(), "2026-08-12T22:00:00.000Z");
  assert.equal(summer.end.toISOString(), "2026-08-13T21:00:00.000Z");
  const winter = cmeEquitySessionFor(new Date("2026-12-10T12:00:00Z"));
  assert.equal(winter.start.toISOString(), "2026-12-09T23:00:00.000Z");
  assert.equal(winter.end.toISOString(), "2026-12-10T22:00:00.000Z");
});

test("range=2d 5분봉을 CME 세션으로 잘라 O/H/L/current와 완료봉 ATR을 만든다", () => {
  const source = payload();
  source.chart.result[0].indicators.quote[0].low[3] = null;
  const result = parseYahooChart(source, "MNQ=F", new Date("2026-08-13T01:00:00Z"));
  assert.equal(result.provider.range, "2d");
  assert.equal(result.session.start, "2026-08-12T22:00:00.000Z");
  assert.equal(result.market.open, 30002);
  assert.equal(result.market.low, 30000);
  assert.equal(result.market.high, 30024);
  assert.equal(result.market.current, 30022);
  assert.ok(result.market.atr5m14 > 0);
  assert.notEqual(result.market.atrLastCompletedBarAt, result.market.latestBarAt);
});

test("MNQ 조회 실패 시 NQ를 예비로 사용한다", async () => {
  const urls = [];
  const snapshot = await fetchYahooSnapshot(async url => {
    urls.push(url);
    if (url.includes("MNQ%3DF")) return { ok: false, status: 429 };
    return { ok: true, status: 200, json: async () => payload("NQ=F") };
  }, new Date("2026-08-13T01:00:00Z"));
  assert.equal(snapshot.provider.requestedSymbol, "NQ=F");
  assert.equal(snapshot.provider.returnedSymbol, "NQ=F");
  assert.equal(urls.length, 3);
  assert.ok(urls.every(url => url.includes("range=2d")));
});

test("배포 스냅샷은 양수 시세와 세션 메타데이터를 갖는다", () => {
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(here, "..", "data", "market.json"), "utf8"));
  assert.equal(snapshot.schemaVersion, 1);
  assert.ok(["MNQ=F", "NQ=F"].includes(snapshot.provider.returnedSymbol));
  assert.equal(snapshot.provider.range, "2d");
  for (const field of ["open", "high", "low", "current", "atr5m14"]) {
    assert.ok(Number(snapshot.market[field]) > 0, field);
  }
  assert.ok(snapshot.market.high >= snapshot.market.current);
  assert.ok(snapshot.market.low <= snapshot.market.current);
  assert.equal(snapshot.session.timeZone, "America/Chicago");
});
