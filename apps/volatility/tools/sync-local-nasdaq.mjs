import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFiveMinuteChartFeatures,
  calculateWilderAtrFromBars
} from "../js/calculator.js";
import { cmeEquitySessionFor } from "../js/market-provider.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const defaultSource = "C:\\Users\\tmddb\\Desktop\\quant\\data\\nasdaq_5m.csv";
const defaultOutput = path.join(appRoot, "data", "local-nasdaq-snapshot.json");
const BAR_MS = 5 * 60_000;
const TICK = 0.25;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function fail(message) {
  throw new Error(message);
}

function tickAligned(value) {
  return Number.isFinite(value) && value > 0 &&
    Math.abs(value / TICK - Math.round(value / TICK)) <= 1e-6;
}

function latestContiguousBars(bars) {
  if (!bars.length) return [];
  let start = bars.length - 1;
  while (start > 0 && bars[start].at.getTime() - bars[start - 1].at.getTime() === BAR_MS) start -= 1;
  return bars.slice(start);
}

export function parseCsv(source) {
  const lines = source.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const header = lines.shift()?.split(",") || [];
  const expected = ["Datetime", "Open", "High", "Low", "Close", "Volume"];
  if (header.join("|") !== expected.join("|")) {
    fail(`nasdaq_5m.csv 헤더가 예상 형식과 다릅니다: ${header.join(",")}`);
  }

  const bars = lines.map((line, offset) => {
    const fields = line.split(",");
    if (fields.length !== expected.length) fail(`CSV ${offset + 2}행의 열 수가 올바르지 않습니다.`);
    const at = new Date(fields[0]);
    const [open, high, low, close, volume] = fields.slice(1).map(Number);
    if (!Number.isFinite(at.getTime()) || at.getTime() % BAR_MS !== 0 ||
        ![open, high, low, close].every(tickAligned) ||
        !Number.isFinite(volume) || volume < 0 ||
        high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      fail(`CSV ${offset + 2}행의 5분봉 검증에 실패했습니다.`);
    }
    return { at, open, high, low, close, volume };
  });
  if (!bars.length) fail("nasdaq_5m.csv에 5분봉이 없습니다.");
  bars.sort((left, right) => left.at - right.at);
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].at.getTime() === bars[index - 1].at.getTime()) {
      fail(`중복된 5분봉 시각이 있습니다: ${bars[index].at.toISOString()}`);
    }
  }
  return bars;
}

export function sessionSnapshot(bars, sourcePath, sourceBytes, generatedAt = new Date()) {
  const candidates = new Map();
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const candidate = cmeEquitySessionFor(bars[index].at);
    if (!candidates.has(candidate.start.toISOString())) {
      candidates.set(candidate.start.toISOString(), candidate);
    }
    if (candidates.size >= 10) break;
  }
  const completed = [...candidates.values()]
    .sort((left, right) => right.end - left.end)
    .map(session => {
      const selected = bars.filter(bar => bar.at >= session.start && bar.at < session.end);
      if (!selected.length || session.end > generatedAt) return null;
      const leadingMissingBucketCount = (selected[0].at.getTime() - session.start.getTime()) / BAR_MS;
      const terminalCovered = selected.at(-1).at.getTime() >= session.end.getTime() - BAR_MS;
      if (!Number.isInteger(leadingMissingBucketCount) || leadingMissingBucketCount < 0 ||
          leadingMissingBucketCount > 2 || !terminalCovered) return null;
      return { session, selected, leadingMissingBucketCount };
    })
    .find(Boolean);
  if (!completed) fail("첫 관측이 시작 2봉 안이고 종료 전 마지막 5분까지 수집된 최근 완료 CME 세션이 없습니다.");
  const { session, selected, leadingMissingBucketCount } = completed;
  const firstObserved = selected[0];
  const latest = selected.at(-1);

  const observed = new Set(selected.map(bar => bar.at.getTime()));
  const missing = [];
  for (let at = firstObserved.at.getTime(); at < session.end.getTime(); at += BAR_MS) {
    if (!observed.has(at)) missing.push(new Date(at).toISOString());
  }
  if (missing.length > 1) {
    fail(`최신 CME 세션의 5분봉이 ${missing.length}개 누락됐습니다.`);
  }

  const high = Math.max(...selected.map(bar => bar.high));
  const low = Math.min(...selected.map(bar => bar.low));
  const current = selected.at(-1).close;
  const atrBars = latestContiguousBars(selected);
  const atr = calculateWilderAtrFromBars(atrBars);
  const historyBars = bars.filter(bar => bar.at.getTime() <= latest.at.getTime())
    .map(bar => ({ at: bar.at.toISOString(), high: bar.high, low: bar.low, close: bar.close }));
  const chartFeatures = buildFiveMinuteChartFeatures(historyBars);
  return {
    schemaVersion: 1,
    mode: "local-archive",
    generatedAt: generatedAt.toISOString(),
    provider: {
      name: "사용자 관리 로컬 Nasdaq 보관 데이터",
      requestedSymbol: "NQ=F",
      returnedSymbol: "NQ=F",
      instrumentType: "continuous-futures-proxy",
      tier: "nq-local-archive-reference",
      fallback: true,
      localArchive: true,
      sourceFile: path.basename(sourcePath),
      sourceSha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
      sourceEventAt: latest.at.toISOString(),
      sourceRowCount: bars.length,
      barQuality: leadingMissingBucketCount > 0
        ? `leading-${leadingMissingBucketCount}${missing.length ? "-plus-one-interior" : ""}-missing-buckets`
        : missing.length ? "one-interior-missing-bucket" : "complete",
      leadingMissingBucketCount,
      leadingMissingBucketAt: leadingMissingBucketCount > 0 ? session.start.toISOString() : null,
      firstObservedBarAt: firstObserved.at.toISOString(),
      missingInteriorBucketCount: missing.length,
      missingInteriorBucketAt: missing[0] || null,
      atrSourceBarCount: atrBars.length
    },
    session: {
      label: `${session.sessionDate} 17:00 CT ~ 16:00 CT · 로컬 보관`,
      date: session.sessionDate,
      timeZone: session.timeZone,
      start: session.start.toISOString(),
      end: session.end.toISOString(),
      status: "completed",
      isCompletedAtFetch: true,
      terminalCoverageVerified: true,
      firstObservedAt: firstObserved.at.toISOString(),
      lastObservedAt: latest.at.toISOString(),
      barCount: selected.length,
      expectedBarCount: Math.round((session.end - session.start) / BAR_MS),
      missingInteriorBucketCount: missing.length
    },
    market: {
      open: selected[0].open,
      high,
      low,
      current,
      latestBarAt: latest.at.toISOString(),
      atr5m14: atr === null ? null : Number(atr.toFixed(6)),
      atrLastCompletedBarAt: atr === null ? null : latest.at.toISOString()
    },
    indicators: chartFeatures.indicators,
    chart5m: chartFeatures.chart5m,
    limitations: [
      "사용자가 별도 수집한 NQ=F 연속선물 5분봉의 최근 완료 세션 참고값입니다.",
      ...(leadingMissingBucketCount > 0
        ? [`세션 시작 ${leadingMissingBucketCount}개 5분봉이 없어 ${firstObserved.at.toISOString()} 첫 관측 시가를 공식 시가가 아닌 기준가로 사용했습니다.`]
        : []),
      "최신 연속 완료 5분봉으로 Wilder ATR(14)을 자동 계산했습니다.",
      "MNQ 실제 월물이 아니므로 최근 관측가 기반 포지션 위험 참고 외의 손절·실전 계산에는 사용하지 않습니다.",
      "정적 동기화 시점 이후 값은 포함하지 않으며 주문 전 증권사 실제 월물과 대조해야 합니다."
    ]
  };
}

function main() {
  const sourcePath = path.resolve(option("--source", defaultSource));
  const outputPath = path.resolve(option("--output", defaultOutput));
  if (!fs.existsSync(sourcePath)) fail(`로컬 나스닥 파일을 찾을 수 없습니다: ${sourcePath}`);
  const sourceBytes = fs.readFileSync(sourcePath);
  const snapshot = sessionSnapshot(parseCsv(sourceBytes.toString("utf8")), sourcePath, sourceBytes);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[OK] ${path.relative(process.cwd(), outputPath)}`);
  console.log(`  source: ${sourcePath}`);
  console.log(`  session: ${snapshot.session.label}`);
  console.log(`  first observed: ${snapshot.provider.firstObservedBarAt}`);
  console.log(`  latest: ${snapshot.market.latestBarAt}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
