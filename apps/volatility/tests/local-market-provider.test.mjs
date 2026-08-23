import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  fetchLocalNasdaqSnapshot,
  shouldPreferLocalArchive,
  validateLocalNasdaqSnapshot
} from "../js/local-market-provider.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.resolve(here, "../data/local-nasdaq-snapshot.json"), "utf8"));
const clone = value => structuredClone(value);

test("동기화된 로컬 NQ 완료 세션 스냅샷을 검증한다", () => {
  const result = validateLocalNasdaqSnapshot(clone(fixture));
  assert.equal(result.mode, "local-archive");
  assert.equal(result.provider.tier, "nq-local-archive-reference");
  assert.equal(result.provider.sourceFile, "nasdaq_5m.csv");
  assert.equal(result.session.terminalCoverageVerified, true);
  assert.equal(result.market.atr5m14, null);
  assert.doesNotMatch(JSON.stringify(result), /C:\\\\Users\\\\tmddb/);
});

test("로컬 NQ 출처·세션·가격 위조를 거부한다", () => {
  for (const mutate of [
    value => { value.provider.returnedSymbol = "MNQ=F"; },
    value => { value.provider.sourceSha256 = "bad"; },
    value => { value.session.terminalCoverageVerified = false; },
    value => { value.market.high = value.market.open - 1; }
  ]) {
    const candidate = clone(fixture);
    mutate(candidate);
    assert.throws(() => validateLocalNasdaqSnapshot(candidate));
  }
});

test("로컬 파일 조회는 같은 출처 JSON을 no-store로 한 번 읽는다", async () => {
  const calls = [];
  const result = await fetchLocalNasdaqSnapshot(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  });
  assert.equal(result.provider.returnedSymbol, "NQ=F");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "./data/local-nasdaq-snapshot.json");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "same-origin");
});

test("Chicago 기준 금요일 장 마감부터 일요일 재개 전까지만 로컬을 우선한다", () => {
  assert.equal(shouldPreferLocalArchive(new Date("2026-08-21T21:00:00Z")), true);
  assert.equal(shouldPreferLocalArchive(new Date("2026-08-22T15:00:00Z")), true);
  assert.equal(shouldPreferLocalArchive(new Date("2026-08-23T21:59:59Z")), true);
  assert.equal(shouldPreferLocalArchive(new Date("2026-08-23T22:00:00Z")), false);
  assert.equal(shouldPreferLocalArchive(new Date("2026-08-24T15:00:00Z")), false);
});
