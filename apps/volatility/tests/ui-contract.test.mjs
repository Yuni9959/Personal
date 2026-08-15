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

test("Personal Tap 허브에 안정 Vercel 입학정보 주소가 안전한 외부 링크로 등록돼 있다", () => {
  const apps = read("apps.js");
  assert.match(apps, /id: "university-admission"/);
  assert.match(apps, /href: "https:\/\/university-admission-private-preview-yuni14\.vercel\.app\/"/);
  assert.match(apps, /badge: "VERCEL"/);
  assert.match(apps, /external: true/);
  assert.doesNotMatch(apps, /university-admission-private-preview-[a-z0-9]+-yuni14\.vercel\.app/);
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
  const styles = read("apps/volatility/styles.css");
  assert.match(html, /장중 실전 기본선/);
  assert.match(html, /종가 방향을 모르는 상태의 전체 거래일 기준/);
  assert.match(html, /평균 H−L 범위 예산/);
  assert.match(html, /조건부 안전측 상승폭/);
  assert.match(html, /조건부 안전측 하락폭/);
  assert.match(html, /장중 기본 상승선 · OOS/);
  assert.match(html, /장중 기본 하락선 · OOS/);
  assert.match(html, /양봉 마감 조건부 복기선 · OOS/);
  assert.match(html, /음봉 마감 조건부 복기선 · OOS/);
  assert.match(html, /id="referenceOpenPrice"/);
  assert.match(html, /id="bullMeanPrice"/);
  assert.match(html, /id="bearMeanPrice"/);
  assert.match(html, /id="bullLivePrice"/);
  assert.match(html, /id="bearLivePrice"/);
  assert.match(html, /id="bullConditionalPrice"/);
  assert.match(html, /id="bearConditionalPrice"/);
  assert.match(html, /시가 환산 참고선 · 범위 예산 · 목표가 아님/);
  assert.match(html, /마감 후 복기용/);
  assert.match(html, /OOS=가격선 도달률≠매매 성공률 · 조건부=마감 후 복기/);
  assert.match(html, /class="reference-warning" aria-label="OOS는 과거 가격선 도달률이며 매매 성공률이 아닙니다/);
  assert.match(html, /과거 가격선 도달률이지 매매 성공률이 아닙니다/);
  assert.match(html, /도달 임계선일 뿐 예상 종가·수익 보장값이 아닙니다/);
  assert.match(app, /REFERENCE\.exAnte\.up\.safePercent/);
  assert.match(app, /REFERENCE\.exAnte\.down\.safePercent/);
  assert.match(app, /renderReferencePrices\(referenceVisible \? market : null\)/);
  assert.match(app, /assessment\.referenceLineCalculationAllowed === true/);
  assert.match(app, /calculateSafeReachScenario\(market, row\.direction, row\.percent\(\)\)/);
  assert.match(styles, /\.reference-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(styles, /\.reference-warning\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.reference-card \{ order: -1; \}/);
  assert.match(app, /최근 52주 OOS/);
  assert.doesNotMatch(html, /1\.409%.*안전측/);
});

test("지연 시세는 사용자 요청 때만 조회하고 실패한 이전값은 계산에서 차단한다", () => {
  const html = read("apps/volatility/index.html");
  const app = read("apps/volatility/js/app.js");
  const policy = read("apps/volatility/js/snapshot-policy.js");
  const guard = read("apps/volatility/js/request-guard.js");
  const styles = read("apps/volatility/styles.css");
  const scheduleStart = app.indexOf("function scheduleExpiryCheck()");
  const scheduleEnd = app.indexOf("\n}\n\nfunction renderMarket()", scheduleStart) + 2;
  const scheduleExpiry = app.slice(scheduleStart, scheduleEnd);
  const startupStart = app.indexOf("const cachedSnapshot = loadFallbackSnapshot()");
  const startup = app.slice(startupStart);
  assert.match(html, /오늘 시세 새로고침/);
  assert.match(html, /class="topbar-actions"/);
  assert.match(html, /페이지 최초 진입과 .*오늘 시세 새로고침.* 버튼을 누른 때에만/);
  assert.match(html, /시가 유무와 관계없이 일반 반복 요청은 최대 10초만 막고/);
  assert.match(html, /공급자 429 제한은 최소 60초 이상 따로 지킵니다/);
  assert.match(html, /백그라운드·주기 갱신은 하지 않습니다/);
  assert.match(html, /제공자 가격시각/);
  assert.match(html, /이번 조회시각/);
  assert.match(html, /지연·사용 상태/);
  assert.match(html, /id="currentPriceLabel">현재가/);
  assert.match(html, /방금 영웅문 모바일에서/);
  assert.match(html, /id="manualConfirm"/);
  assert.match(html, /class="manual-disclosure"/);
  assert.match(html, /id="manualToggleBtn"[^>]+aria-expanded="false"[^>]+aria-controls="manualPanel"/);
  assert.match(html, /id="manualPanel" class="manual-panel" hidden/);
  assert.match(html, /자동 조회가 실패했거나 실제 월물을 직접 확인할 때만 여세요/);
  assert.match(html, /class="position-layout"/);
  assert.match(html, /class="position-input-pane"/);
  assert.match(html, /class="position-output-pane"/);
  assert.match(styles, /\.position-layout\s*\{[^}]*grid-template-columns:\s*minmax\(330px,.85fr\) minmax\(0,1.15fr\)/s);
  assert.match(styles, /\.risk-results\s*\{[^}]*grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/s);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.position-layout \{ grid-template-columns: minmax\(0,.88fr\) minmax\(0,1.12fr\);/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.risk-layout \{ grid-template-columns: minmax\(0,.9fr\) minmax\(0,1.1fr\);/);
  assert.doesNotMatch(styles, /@media \(max-width: 340px\)[\s\S]*?\.position-layout, \.risk-layout \{ grid-template-columns: 1fr; \}/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'self' https:\/\/r\.jina\.ai/);
  assert.doesNotMatch(html, /connect-src[^;]*query[12]\.finance\.yahoo\.com/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /id="manualAtr"[^>]+step="any"/);
  assert.match(html, /id="positionAtr"[^>]+step="any"/);
  assert.doesNotMatch(html, /자동 시세 새로고침|실시간 시세|LIVE DEFAULT/);
  assert.match(app, /REQUEST_COOLDOWN_MS/);
  assert.doesNotMatch(app, /hasUsableQuote/);
  assert.match(guard, /requestedAt = Math\.max\(memoryAt, storedAt\)/);
  assert.match(app, /10초 중복 조회 방지 대기 중입니다/);
  assert.match(app, /refreshMarket\(\{ trigger: "load" \}\)/);
  assert.match(app, /fetchYahooSnapshot\(fetch, new Date\(\), \{\s*timeoutMs: REQUEST_DEADLINE_MS\s*\}\)/);
  assert.match(app, /forceLockReason: reason/);
  assert.doesNotMatch(app, /clearManualQuoteInputs|populateManual/);
  assert.match(app, /setManualPanelExpanded\(false\)/);
  assert.match(app, /cachedAssessment\.displayable/);
  assert.match(app, /cachedAssessment\.referenceOnly/);
  assert.match(startup, /applySnapshot\(cachedSnapshot, \{\s*cache: false,\s*forceLockReason: cachedAssessment\.referenceOnly\s*\? ""\s*: "새 시세를 확인하기 전 마지막 검증값을 읽기 전용으로 표시합니다\."\s*\}\)/);
  assert.match(app, /els\.currentPriceLabel\.textContent = assessment\.referenceOnly \? "마지막 관측가" : "현재가"/);
  assert.match(app, /els\.currentPriceLabel\.textContent = "현재가"/);
  assert.match(app, /setCompactDataStatus\("loading", "조회 중"\)/);
  assert.match(app, /setCompactDataStatus\("delayed", "시세 사용 가능"\)/);
  assert.match(app, /setCompactDataStatus\("stale", "시세 만료"\)/);
  assert.match(app, /setCompactDataStatus\("error", "시세 없음"\)/);
  assert.match(app, /setCompactDataStatus\("manual", "수동 입력"\)/);
  assert.match(app, /els\.currentPrice\.textContent = displayable \? formatNumber\(market\.current\) : "—"/);
  assert.match(app, /state\.calculationAllowed = assessment\.calculationAllowed === true/);
  assert.match(app, /5분봉 1개 결손 · H\/L\/현재가·시각은 공급자 메타와 교차검증, 시가는 첫 세션봉 기준 · ATR\/손절 자동 계산 중지/);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  assert.match(scheduleExpiry, /if \(!state\.snapshot \|\| !state\.assessment\?\.displayable\) return/);
  assert.match(scheduleExpiry, /if \(state\.assessment\.referenceOnly\) \{[\s\S]*window\.setTimeout\([\s\S]*renderMarket\(\)[\s\S]*60_000[\s\S]*return/s);
  assert.match(app, /if \(!assessment\.usable\) \{[\s\S]*scheduleExpiryCheck\(\)[\s\S]*setCalculationLock\(true, lockReason\)/s);
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
  assert.match(policy, /NQ 대체 연속선물은 MNQ가 아니므로 자동 계산이나 이전값 미리보기에 사용하지 않습니다/);
  assert.match(policy, /requested === "MNQ=F" && returned === "MNQ=F"/);
  assert.match(policy, /provider\.tier === "mnq-continuous-proxy"/);
  assert.doesNotMatch(policy, /provider\.tier === undefined/);
  assert.match(policy, /MNQ=F로 검증되지 않은 종목·출처 응답이어서 계산과 이전값 미리보기를 중지합니다/);
  assert.match(policy, /새 기준을 검증·반영하기 전에는 계산을 중지합니다/);
  assert.match(app, /이전 값으로 자동 계산하지 않습니다/);
  assert.doesNotMatch(app, /setInterval\s*\(/);
});

test("Service Worker가 Volatility 필수 자산과 오프라인 탐색을 포함한다", () => {
  const sw = read("sw.js");
  assert.match(sw, /v3\.4\.0-volatility-weekend-review\.1/);
  for (const asset of [
    "./apps/volatility/index.html", "./apps/volatility/styles.css",
    "./apps/volatility/js/app.js", "./apps/volatility/js/calculator.js",
    "./apps/volatility/js/market-provider.js", "./apps/volatility/js/request-guard.js",
    "./apps/volatility/js/snapshot-policy.js"
  ]) assert.ok(sw.includes(`"${asset}"`), asset);
  assert.match(sw, /request\.url\.includes\("\/apps\/volatility\/"\)/);
  assert.match(sw, /const cached = await caches\.match\(request\);\s*if \(cached\) return cached;/);
  assert.match(sw, /new Request\(asset, \{ cache: "reload" \}\)/);
  assert.doesNotMatch(sw, /apps\/volatility\/data\/market\.json/);
});

test("GitHub Pages workflow는 push·수동 실행 때만 비밀키 없이 정적 앱을 배포한다", () => {
  const workflow = read(".github/workflows/deploy-pages.yml");
  const dependabot = read(".github/dependabot.yml");
  assert.match(workflow, /workflow_dispatch:/);
  for (const action of [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d",
    "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
    "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"
  ]) assert.ok(workflow.includes(action), action);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+/);
  assert.match(workflow, /run: npm run test:release/);
  assert.match(workflow, /CHROMIUM_PATH:\s+\/usr\/bin\/google-chrome/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.doesNotMatch(workflow, /update-market-data\.mjs/);
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.match(dependabot, /package-ecosystem:\s+github-actions/);
  assert.match(dependabot, /interval:\s+weekly/);
});
