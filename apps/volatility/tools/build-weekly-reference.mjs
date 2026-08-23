import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const DEFAULT_SOURCE = "C:\\Users\\tmddb\\Desktop\\quant\\data\\nasdaq_daily.csv";
const DEFAULT_OUTPUT = path.join(appRoot, "js", "weekly-reference.generated.js");
const LOOKBACK_YEARS = 5;
const HOLDOUT_WEEKS = 52;
const PRIMARY_HIT_FLOOR = 0.70;
const QUANTILES = [0.10, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50];
const WILSON_Z_95 = 1.959963984540054;
const BOOTSTRAP_REPETITIONS = 5000;
const BOOTSTRAP_BLOCK_WEEKS = 4;
const SUPERSEDED_DATES = new Set(["2026-01-19", "2026-02-16", "2026-05-25"]);

const SCOPE_SPECS = Object.freeze({
  conditional_bull_up: { metric: "upReachPercent", direction: "bull" },
  conditional_bear_down: { metric: "downReachPercent", direction: "bear" },
  exante_all_up: { metric: "upReachPercent", direction: null },
  exante_all_down: { metric: "downReachPercent", direction: null }
});

function fail(message) {
  throw new Error(message);
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromIso(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function shiftDays(value, days) {
  const date = dateFromIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function shiftYears(value, years) {
  const date = dateFromIso(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return isoDate(date);
}

function nextMonday(value) {
  const date = dateFromIso(value);
  const days = (8 - date.getUTCDay()) % 7 || 7;
  return shiftDays(value, days);
}

function kstDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

export function currentKstWeek(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail("유효한 기준시각이 필요합니다.");
  const { year, month, day } = kstDateParts(date);
  const today = `${year}-${month}-${day}`;
  const weekday = dateFromIso(today).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const effectiveFrom = shiftDays(today, -daysSinceMonday);
  return {
    today,
    effectiveFrom,
    effectiveThrough: shiftDays(effectiveFrom, 6)
  };
}

function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) fail("nasdaq_daily.csv의 따옴표가 닫히지 않았습니다.");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some(value => value !== "")) rows.push(row);
  }
  return rows;
}

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDailyCsv(text, { anchorDate } = {}) {
  const records = parseCsvRecords(text);
  const header = records.shift();
  if (!header?.includes("Date")) fail("nasdaq_daily.csv에 Date 열이 없습니다.");
  const columns = new Map(header.map((name, index) => [name, index]));
  const valueAt = (fields, field) => {
    const tuple = finiteNumber(fields[columns.get(`('${field}', 'NQ=F')`)]);
    return tuple ?? finiteNumber(fields[columns.get(field)]);
  };
  const parsed = records.map((fields, offset) => {
    if (fields.length !== header.length) fail(`nasdaq_daily.csv ${offset + 2}행의 열 수가 올바르지 않습니다.`);
    const at = new Date(fields[columns.get("Date")]);
    const date = Number.isFinite(at.getTime()) ? isoDate(at) : null;
    const open = valueAt(fields, "Open");
    const high = valueAt(fields, "High");
    const low = valueAt(fields, "Low");
    const close = valueAt(fields, "Close");
    return { sourceRow: offset + 2, date, open, high, low, close };
  });
  const dateCounts = new Map();
  for (const row of parsed) {
    if (row.date) dateCounts.set(row.date, (dateCounts.get(row.date) || 0) + 1);
  }
  const clean = [];
  for (const row of parsed) {
    const prices = [row.open, row.high, row.low, row.close];
    const invalid = !row.date || prices.some(value => value === null || value <= 0) ||
      row.high <= row.low || row.high < Math.max(row.open, row.close) ||
      row.low > Math.min(row.open, row.close) || dateCounts.get(row.date) > 1 ||
      dateFromIso(row.date).getUTCDay() === 0 || SUPERSEDED_DATES.has(row.date) ||
      (anchorDate && row.date >= anchorDate);
    if (invalid) continue;
    const direction = row.close > row.open ? "bull" : row.close < row.open ? "bear" : "doji";
    clean.push({
      ...row,
      direction,
      rangePercent: (row.high - row.low) / row.open * 100,
      upReachPercent: (row.high - row.open) / row.open * 100,
      downReachPercent: (row.open - row.low) / row.open * 100
    });
  }
  clean.sort((left, right) => left.date.localeCompare(right.date));
  if (!clean.length) fail("nasdaq_daily.csv에 분석 가능한 완료 일봉이 없습니다.");
  return clean;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values, q) {
  if (!values.length) fail("분위수를 계산할 표본이 없습니다.");
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function sigmaClean(values) {
  const raw = values.filter(Number.isFinite);
  if (!raw.length) fail("2σ 정제를 계산할 표본이 없습니다.");
  const rawMean = mean(raw);
  const variance = raw.length > 1
    ? raw.reduce((sum, value) => sum + (value - rawMean) ** 2, 0) / (raw.length - 1)
    : 0;
  const standardDeviation = Math.sqrt(variance);
  const lower = rawMean - 2 * standardDeviation;
  const upper = rawMean + 2 * standardDeviation;
  const used = raw.length > 1 ? raw.filter(value => value >= lower && value <= upper) : raw;
  return { raw, used, rawMean, cleanMean: mean(used), lower, upper };
}

export function wilsonInterval(hits, sampleCount) {
  if (!sampleCount) return [null, null];
  const rate = hits / sampleCount;
  const denominator = 1 + WILSON_Z_95 ** 2 / sampleCount;
  const center = (rate + WILSON_Z_95 ** 2 / (2 * sampleCount)) / denominator;
  const half = WILSON_Z_95 * Math.sqrt(
    rate * (1 - rate) / sampleCount + WILSON_Z_95 ** 2 / (4 * sampleCount ** 2)
  ) / denominator;
  return [center - half, center + half];
}

function scopeValues(rows, spec) {
  return rows
    .filter(row => spec.direction === null || row.direction === spec.direction)
    .map(row => row[spec.metric]);
}

function scopeRows(rows, spec) {
  return rows.filter(row => spec.direction === null || row.direction === spec.direction);
}

function recordsForPolicy(rows, currentAnchor) {
  const holdoutStart = shiftDays(currentAnchor, -7 * HOLDOUT_WEEKS);
  const history = Object.fromEntries(Object.keys(SCOPE_SPECS).map(scope => [
    scope,
    Object.fromEntries(QUANTILES.map(q => [String(q), { selection: [], holdout: [] }]))
  ]));
  let anchor = nextMonday(shiftYears(rows[0].date, LOOKBACK_YEARS));
  while (anchor <= currentAnchor) {
    const trainStart = shiftYears(anchor, -LOOKBACK_YEARS);
    const train = rows.filter(row => row.date >= trainStart && row.date < anchor);
    const testEnd = shiftDays(anchor, 7);
    const test = rows.filter(row => row.date >= anchor && row.date < testEnd);
    if (train.length >= 1000) {
      for (const [scope, spec] of Object.entries(SCOPE_SPECS)) {
        const values = sigmaClean(scopeValues(train, spec)).used;
        const targets = new Map(QUANTILES.map(q => [q, quantile(values, q)]));
        for (const row of scopeRows(test, spec)) {
          const period = row.date < holdoutStart ? "selection" : row.date < currentAnchor ? "holdout" : null;
          if (!period) continue;
          for (const q of QUANTILES) {
            const target = targets.get(q);
            history[scope][String(q)][period].push({
              anchor,
              target,
              actual: row[spec.metric],
              hit: row[spec.metric] >= target
            });
          }
        }
      }
    }
    anchor = shiftDays(anchor, 7);
  }
  return { history, holdoutStart };
}

function summarize(records) {
  const sampleCount = records.length;
  const hits = records.reduce((sum, record) => sum + Number(record.hit), 0);
  const [wilsonLow, wilsonHigh] = wilsonInterval(hits, sampleCount);
  return {
    sampleCount,
    hits,
    hitRate: sampleCount ? hits / sampleCount : null,
    wilsonLow,
    wilsonHigh,
    meanTarget: sampleCount ? mean(records.map(record => record.target)) : null
  };
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function movingWeekBlockInterval(records, scope, q) {
  if (!records.length) return [null, null];
  const byWeek = new Map();
  for (const record of records) {
    const week = byWeek.get(record.anchor) || { hits: 0, size: 0 };
    week.hits += Number(record.hit);
    week.size += 1;
    byWeek.set(record.anchor, week);
  }
  const weeks = [...byWeek.values()];
  if (weeks.length < 2) return wilsonInterval(records.filter(record => record.hit).length, records.length);
  const seedHex = crypto.createHash("sha256").update(`${scope}|2sigma_clean|${q}`).digest("hex").slice(0, 8);
  const random = seededRandom((Number.parseInt(seedHex, 16) + 42) >>> 0);
  const block = Math.min(BOOTSTRAP_BLOCK_WEEKS, weeks.length);
  const blockCount = Math.ceil(weeks.length / block);
  const samples = [];
  for (let iteration = 0; iteration < BOOTSTRAP_REPETITIONS; iteration += 1) {
    let hits = 0;
    let size = 0;
    let selectedWeeks = 0;
    for (let blockIndex = 0; blockIndex < blockCount && selectedWeeks < weeks.length; blockIndex += 1) {
      const start = Math.floor(random() * weeks.length);
      for (let offset = 0; offset < block && selectedWeeks < weeks.length; offset += 1) {
        const week = weeks[(start + offset) % weeks.length];
        hits += week.hits;
        size += week.size;
        selectedWeeks += 1;
      }
    }
    samples.push(hits / size);
  }
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

function choosePolicies(history) {
  const policies = {};
  for (const scope of Object.keys(SCOPE_SPECS)) {
    const candidates = QUANTILES.map(q => {
      const records = history[scope][String(q)].selection;
      return { q, records, ...summarize(records) };
    });
    const eligible = candidates.filter(candidate => candidate.wilsonLow >= PRIMARY_HIT_FLOOR);
    const chosen = eligible.length
      ? [...eligible].sort((left, right) => left.meanTarget - right.meanTarget || left.q - right.q).at(-1)
      : [...candidates].sort((left, right) => left.q - right.q || left.meanTarget - right.meanTarget)[0];
    const holdoutRecords = history[scope][String(chosen.q)].holdout;
    policies[scope] = {
      q: chosen.q,
      selection: summarize(chosen.records),
      holdout: summarize(holdoutRecords),
      holdoutBlock: movingWeekBlockInterval(holdoutRecords, scope, chosen.q)
    };
  }
  return policies;
}

function percent(value) {
  return value === null ? null : value * 100;
}

function runtimeLine(rows, scope, policy) {
  const audit = sigmaClean(scopeValues(rows, SCOPE_SPECS[scope]));
  return {
    safePercent: quantile(audit.used, policy.q),
    safeQuantile: policy.q,
    selectionHitRate: percent(policy.selection.hitRate),
    selectionWilson95Low: percent(policy.selection.wilsonLow),
    walkForwardSampleCount: policy.holdout.sampleCount,
    walkForwardHitRate: percent(policy.holdout.hitRate),
    walkForwardWilson95Low: percent(policy.holdout.wilsonLow),
    walkForwardWilson95High: percent(policy.holdout.wilsonHigh),
    walkForwardBlock95Low: percent(policy.holdoutBlock[0]),
    walkForwardBlock95High: percent(policy.holdoutBlock[1]),
    currentWindowSampleCount: audit.raw.length,
    currentWindowUsedCount: audit.used.length
  };
}

function kstIso(date) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60_000);
  return `${shifted.toISOString().slice(0, -1)}+09:00`;
}

export function buildWeeklyReference(sourceBytes, { now = new Date(), sourceName = "nasdaq_daily.csv" } = {}) {
  const week = currentKstWeek(now);
  const rows = parseDailyCsv(sourceBytes.toString("utf8"), { anchorDate: week.effectiveFrom });
  const fitStart = shiftYears(week.effectiveFrom, -LOOKBACK_YEARS);
  const fitRows = rows.filter(row => row.date >= fitStart && row.date < week.effectiveFrom);
  if (fitRows.length < 1000) fail("주간 기준을 계산할 직전 5년 일봉이 충분하지 않습니다.");
  const { history, holdoutStart } = recordsForPolicy(rows, week.effectiveFrom);
  const policies = choosePolicies(history);
  const bullRange = sigmaClean(fitRows.filter(row => row.direction === "bull").map(row => row.rangePercent));
  const bearRange = sigmaClean(fitRows.filter(row => row.direction === "bear").map(row => row.rangePercent));
  const bull = runtimeLine(fitRows, "conditional_bull_up", policies.conditional_bull_up);
  const bear = runtimeLine(fitRows, "conditional_bear_down", policies.conditional_bear_down);
  const up = runtimeLine(fitRows, "exante_all_up", policies.exante_all_up);
  const down = runtimeLine(fitRows, "exante_all_down", policies.exante_all_down);
  const fixedThresholdSummary = records => summarize(records.map(record => ({
    ...record,
    hit: record.actual >= 1.409
  })));
  const fixedUp = fixedThresholdSummary(history.exante_all_up[String(0.25)].holdout);
  const fixedDown = fixedThresholdSummary(history.exante_all_down[String(0.25)].holdout);
  return {
    schemaVersion: 3,
    effectiveFrom: week.effectiveFrom,
    effectiveThrough: week.effectiveThrough,
    calculatedAt: kstIso(now),
    sourceSymbol: "NQ continuous proxy",
    sourceDataset: sourceName,
    sourceSha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
    fitStart,
    fitEndExclusive: week.effectiveFrom,
    holdoutStart,
    lookbackYears: LOOKBACK_YEARS,
    method: "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
    bullPercent: bullRange.cleanMean,
    bearPercent: bearRange.cleanMean,
    directions: {
      bull: {
        rangeMeanPercent: bullRange.cleanMean,
        rangeRawSampleCount: bullRange.raw.length,
        rangeUsedSampleCount: bullRange.used.length,
        ...bull
      },
      bear: {
        rangeMeanPercent: bearRange.cleanMean,
        rangeRawSampleCount: bearRange.raw.length,
        rangeUsedSampleCount: bearRange.used.length,
        ...bear
      }
    },
    exAnte: { up, down },
    rejectedIllustration: {
      percent: 1.409,
      reason: `최근 52주 방향 미확정 도달률이 상승 ${(fixedUp.hitRate * 100).toFixed(1)}%, 하락 ${(fixedDown.hitRate * 100).toFixed(1)}%로 안전선에 부적합`
    }
  };
}

export function renderReferenceModule(reference) {
  return `// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.\n` +
    `function deepFreeze(value) {\n` +
    `  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;\n` +
    `  for (const child of Object.values(value)) deepFreeze(child);\n` +
    `  return Object.freeze(value);\n` +
    `}\n\n` +
    `export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze(${JSON.stringify(reference, null, 2)});\n`;
}

async function main() {
  const sourcePath = path.resolve(option("--source", DEFAULT_SOURCE));
  const outputPath = path.resolve(option("--output", DEFAULT_OUTPUT));
  const nowValue = option("--now", null);
  const now = nowValue ? new Date(nowValue) : new Date();
  if (!fs.existsSync(sourcePath)) fail(`나스닥 일봉 파일을 찾을 수 없습니다: ${sourcePath}`);
  const sourceBytes = fs.readFileSync(sourcePath);
  const reference = buildWeeklyReference(sourceBytes, { now, sourceName: path.basename(sourcePath) });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderReferenceModule(reference), "utf8");
  console.log(`[OK] ${path.relative(process.cwd(), outputPath)}`);
  console.log(`  source: ${sourcePath}`);
  console.log(`  effective: ${reference.effectiveFrom} ~ ${reference.effectiveThrough}`);
  console.log(`  fit: ${reference.fitStart} ~ ${reference.fitEndExclusive} (exclusive)`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  });
}
