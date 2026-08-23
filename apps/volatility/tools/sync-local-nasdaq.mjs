import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateWilderAtrFromBars } from "../js/calculator.js";
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

function parseCsv(source) {
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

function sessionSnapshot(bars, sourcePath, sourceBytes) {
  const generatedAt = new Date();
  const candidates = new Map();
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const candidate = cmeEquitySessionFor(bars[index].at);
    if (!candidates.has(candidate.start.toISOString())) {
      candidates.set(candidate.start.toISOString(), candidate);
    }
    if (candidates.size >= 10) break;
  }
  const session = [...candidates.values()]
    .sort((left, right) => right.end - left.end)
    .find(candidate => candidate.end <= generatedAt &&
      bars.some(bar => bar.at.getTime() === candidate.start.getTime()) &&
      bars.some(bar => bar.at.getTime() >= candidate.end.getTime() - BAR_MS && bar.at < candidate.end));
  if (!session) fail("첫 봉부터 종료 전 마지막 5분까지 수집된 최근 완료 CME 세션이 없습니다.");
  const selected = bars.filter(bar => bar.at >= session.start && bar.at < session.end);
  const latest = selected.at(-1);

  const observed = new Set(selected.map(bar => bar.at.getTime()));
  const missing = [];
  for (let at = session.start.getTime(); at < session.end.getTime(); at += BAR_MS) {
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
      barQuality: missing.length ? "one-interior-missing-bucket" : "complete",
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
    limitations: [
      "사용자가 별도 수집한 NQ=F 연속선물 5분봉의 최근 완료 세션 참고값입니다.",
      "최신 연속 완료 5분봉으로 Wilder ATR(14)을 자동 계산했습니다.",
      "MNQ 실제 월물이 아니므로 최근 관측가 기반 포지션 위험 참고 외의 손절·실전 계산에는 사용하지 않습니다.",
      "정적 동기화 시점 이후 값은 포함하지 않으며 주문 전 증권사 실제 월물과 대조해야 합니다."
    ]
  };
}

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
console.log(`  latest: ${snapshot.market.latestBarAt}`);
