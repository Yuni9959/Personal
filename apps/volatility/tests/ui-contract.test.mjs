import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("Personal Tap 허브에 Volatility 앱 입구가 활성화돼 있다", () => {
  const apps = read("apps.js");
  assert.match(apps, /id: "volatility"/);
  assert.match(apps, /href: "\.\/apps\/volatility\/"/);
  assert.match(apps, /enabled: true/);
});

test("시나리오를 목표가나 통계적 기대수익으로 표시하지 않는다", () => {
  const html = read("apps/volatility/index.html");
  const app = read("apps/volatility/js/app.js");
  assert.match(html, /목표가가 아닌/);
  assert.match(html, /통계적 기대값이 아닙니다/);
  assert.match(html, /양봉·음봉은 종가 확정 전에 알 수 없어/);
  assert.match(html, /P6 AND · SHADOW 경고/);
  assert.match(html, /기존 OR 규칙 · 비활성 비교용/);
  assert.match(html, /P7 · 입력 기반 미검증 알림/);
  assert.match(html, /검증 표본이 각 한 건/);
  assert.match(html, /실증에서 과잉차단/);
  assert.match(app, /P6 shadow 경고 후보/);
  assert.match(app, /기존 OR 규칙 감지 · 비활성/);
  assert.match(app, /P7 입력 기반 안전 알림 · 미검증/);
  assert.doesNotMatch(app, /P6 금지 · 진입 차단|OR 강제차단 발동/);
});

test("평균·실전 ex-ante·사후 조건부 안전선을 시각적으로 분리한다", () => {
  const html = read("apps/volatility/index.html");
  const app = read("apps/volatility/js/app.js");
  assert.match(html, /장중 실전 기본선/);
  assert.match(html, /종가 방향을 모르는 상태의 전체 거래일 기준/);
  assert.match(html, /평균 H−L 범위 예산/);
  assert.match(html, /조건부 안전측 상승폭/);
  assert.match(html, /조건부 안전측 하락폭/);
  assert.match(html, /도달 임계선일 뿐 예상 종가·수익 보장값이 아닙니다/);
  assert.match(app, /REFERENCE\.exAnte\.up\.safePercent/);
  assert.match(app, /REFERENCE\.exAnte\.down\.safePercent/);
  assert.match(app, /최근 52주 OOS/);
  assert.doesNotMatch(html, /1\.409%.*안전측/);
});

test("Service Worker가 Volatility 필수 자산과 오프라인 탐색을 포함한다", () => {
  const sw = read("sw.js");
  for (const asset of [
    "./apps/volatility/index.html", "./apps/volatility/styles.css",
    "./apps/volatility/js/app.js", "./apps/volatility/js/calculator.js",
    "./apps/volatility/js/market-provider.js", "./apps/volatility/data/market.json"
  ]) assert.ok(sw.includes(`"${asset}"`), asset);
  assert.match(sw, /request\.url\.includes\("\/apps\/volatility\/"\)/);
  assert.match(sw, /url\.pathname\.endsWith\("\/apps\/volatility\/data\/market\.json"\)/);
});

test("GitHub Pages workflow가 비밀키 없이 정적 시세를 새로 만들어 배포한다", () => {
  const workflow = read(".github/workflows/deploy-pages.yml");
  assert.match(workflow, /update-market-data\.mjs --allow-stale/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /\bsecrets\./);
});
