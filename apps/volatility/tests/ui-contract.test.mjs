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

test("지연 시세는 사용자 요청 때만 조회하고 실패한 이전값은 계산에서 차단한다", () => {
  const html = read("apps/volatility/index.html");
  const app = read("apps/volatility/js/app.js");
  const policy = read("apps/volatility/js/snapshot-policy.js");
  assert.match(html, /요청 시 지연 시세 확인/);
  assert.match(html, /페이지 최초 진입과 버튼을 누른 때에만/);
  assert.match(html, /백그라운드·주기 갱신은 하지 않습니다/);
  assert.match(html, /제공자 가격시각/);
  assert.match(html, /이번 조회시각/);
  assert.match(html, /지연·사용 상태/);
  assert.match(html, /방금 영웅문 모바일에서/);
  assert.match(html, /id="manualConfirm"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'self' https:\/\/query1\.finance\.yahoo\.com/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /id="manualAtr"[^>]+step="any"/);
  assert.match(html, /id="positionAtr"[^>]+step="any"/);
  assert.doesNotMatch(html, /자동 시세 새로고침|실시간 시세|LIVE DEFAULT/);
  assert.match(app, /REQUEST_COOLDOWN_MS/);
  assert.match(app, /refreshMarket\(\{ trigger: "load" \}\)/);
  assert.match(app, /fetchYahooSnapshot\(fetch, new Date\(\), \{\s*timeoutMs: REQUEST_DEADLINE_MS\s*\}\)/);
  assert.match(app, /forceLockReason: reason/);
  assert.match(app, /clearManualQuoteInputs\(\)/);
  assert.match(app, /scheduleExpiryCheck\(\)/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /actualContractConfirmed: true/);
  assert.match(app, /withExclusiveRequest/);
  assert.match(app, /A wall-clock rollback must not turn the request guard into a bypass/);
  assert.match(app, /A later quote must/);
  assert.match(app, /positionAtrBinding/);
  assert.match(app, /source: "user-fixed"/);
  assert.match(app, /isValidAtrBinding/);
  assert.doesNotMatch(app, /Number\.isFinite\(Number\(state\.autoAtr\)\)/);
  assert.doesNotMatch(app, /populateManual/);
  assert.match(policy, /MAX_SOURCE_AGE_MINUTES = 25/);
  assert.match(policy, /NQ 대체 프록시는 MNQ가 아니므로 자동 계산에 사용하지 않습니다/);
  assert.match(policy, /requested === "MNQ=F" && returned === "MNQ=F"/);
  assert.match(policy, /provider\.tier === "mnq-continuous-proxy"/);
  assert.doesNotMatch(policy, /provider\.tier === undefined/);
  assert.match(policy, /MNQ=F로 검증되지 않은 종목·출처 식별값이어서 자동 계산을 중지했습니다/);
  assert.match(policy, /새 기준을 검증·배포하기 전 계산을 중지합니다/);
  assert.match(app, /이전 값으로 자동 계산하지 않습니다/);
  assert.doesNotMatch(app, /setInterval\s*\(/);
});

test("Service Worker가 Volatility 필수 자산과 오프라인 탐색을 포함한다", () => {
  const sw = read("sw.js");
  for (const asset of [
    "./apps/volatility/index.html", "./apps/volatility/styles.css",
    "./apps/volatility/js/app.js", "./apps/volatility/js/calculator.js",
    "./apps/volatility/js/market-provider.js", "./apps/volatility/js/request-guard.js",
    "./apps/volatility/js/snapshot-policy.js"
  ]) assert.ok(sw.includes(`"${asset}"`), asset);
  assert.match(sw, /request\.url\.includes\("\/apps\/volatility\/"\)/);
  assert.doesNotMatch(sw, /apps\/volatility\/data\/market\.json/);
});

test("GitHub Pages workflow는 push·수동 실행 때만 비밀키 없이 정적 앱을 배포한다", () => {
  const workflow = read(".github/workflows/deploy-pages.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /actions\/configure-pages@v6/);
  assert.match(workflow, /run: npm run test:release/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.doesNotMatch(workflow, /update-market-data\.mjs/);
  assert.doesNotMatch(workflow, /\bsecrets\./);
});
