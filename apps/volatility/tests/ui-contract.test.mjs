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
  const index = read("index.html");
  const hub = read("hub.js");
  assert.match(apps, /id: "volatility"/);
  assert.match(apps, /href: "\.\/apps\/volatility\/"/);
  assert.match(apps, /enabled: true/);
  assert.match(index, /<script type="module" src="\.\/hub\.js"><\/script>/);
  assert.match(hub, /weekly-reference\.generated\.js/);
  assert.doesNotMatch(hub, /상승 0\.360% · 하락 0\.295%/);
});

test("Volatility 주간 기준은 오늘 날짜 기반 생성 도구와 단일 동기화 명령으로 관리한다", () => {
  const packageJson = JSON.parse(read("package.json"));
  const calculator = read("apps/volatility/js/calculator.js");
  const generated = read("apps/volatility/js/weekly-reference.generated.js");
  const tool = read("apps/volatility/tools/build-weekly-reference.mjs");
  const localTool = read("apps/volatility/tools/sync-local-nasdaq.mjs");
  assert.equal(packageJson.scripts["sync:volatility-reference"], "node apps/volatility/tools/build-weekly-reference.mjs");
  assert.match(packageJson.scripts["sync:volatility-data"], /sync-local-nasdaq\.mjs && npm run sync:volatility-reference/);
  assert.match(calculator, /weekly-reference\.generated\.js/);
  assert.doesNotMatch(calculator, /effectiveFrom: "2026-/);
  assert.match(generated, /직접 수정하지 마세요/);
  assert.match(tool, /timeZone: "Asia\/Seoul"/);
  assert.match(tool, /row\.date >= trainStart && row\.date < anchor/);
  assert.match(localTool, /calculateWilderAtrFromBars/);
  assert.match(localTool, /latestContiguousBars/);
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
  assert.match(html, /대손실 회피 체크리스트 · 8항목/);
  assert.match(html, /같은 포지션 입력 사용/);
  assert.match(html, /네 가지 과거 군집 중 현재 경향/);
  assert.match(html, /확정 분류나 손실 확률이 아닙니다/);
  assert.match(app, /classifyLiveTradePattern/);
  assert.match(app, /calculatePositionPathFeatures/);
  assert.match(app, /고변동·약세 복합 경고/);
  assert.match(app, /10분 무반응 경고/);
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
  assert.match(html, /기준가 환산 참고선 · 범위 예산 · 목표가 아님/);
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
  assert.match(app, /"최근 기준 시가"/);
  assert.match(app, /"최근 첫 관측 기준가"/);
  assert.match(app, /els\.referenceOpenLabel\.textContent = "첫 관측 기준가"/);
  assert.match(app, /공식 시가 아님/);
  assert.match(app, /snapshot\.provider\?\.firstObservedBarAt/);
  assert.doesNotMatch(app, /formatCompactDate\(snapshot\.market\?\.latestBarAt\).*기준/);
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
  assert.match(html, /페이지 최초 진입과 .*오늘 시세 새로고침.* 버튼을 누른 때에만 값을 확인합니다/);
  assert.match(html, /버튼을 누르면 휴장 여부와 관계없이 Yahoo 최신 MNQ를 먼저 조회하고/);
  assert.match(html, /일반 반복 확인은 최대 10초만 막고/);
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
  assert.match(styles, /\.pattern-indicators\s*\{[^}]*grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)/s);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'self' https:\/\/r\.jina\.ai/);
  assert.doesNotMatch(html, /connect-src[^;]*query[12]\.finance\.yahoo\.com/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /id="manualAtr"[^>]+step="any"/);
  for (const id of ["positionDirection", "entryPrice", "enteredAt", "currentQuantity", "maxQuantity", "addCount"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["positionAtr", "quantity", "fees"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  for (const id of ["ema1h", "rsi1h", "atrPercentile", "noFavorableExcursion", "stopHesitation"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  for (const id of ["patternResults", "patternHeadline", "patternIndicators"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="positionRiskPanel"[^>]+aria-live="polite"/);
  assert.match(html, /id="positionRiskPanel"[\s\S]*id="riskTitle"/);
  assert.doesNotMatch(html, /<section class="panel" aria-labelledby="riskTitle">/);
  assert.match(html, /대손실 회피 체크리스트 · 8항목/);
  assert.match(html, /계약 정보를 더하면 대손실 판정이 완성됩니다/);
  assert.match(app, /assessPositionLossRisk/);
  assert.match(app, /assessTailLossAvoidance/);
  assert.match(app, /function renderTailLossChecklist/);
  assert.match(app, /function positionMarketContext\(\)/);
  assert.match(app, /market\.atr5m14/);
  assert.match(app, /assessment\?\.displayable !== true/);
  assert.match(app, /판정 보류 · 정밀입력 필요/);
  assert.match(app, /미확인 항목은 안전으로 계산하지 않습니다/);
  assert.match(styles, /\.position-risk-checklist/);
  assert.match(styles, /\.precision-inputs/);
  assert.match(styles, /\.tail-evidence-summary/);
  assert.match(styles, /\.integrated-pattern-review/);
  assert.doesNotMatch(html, /자동 시세 새로고침|실시간 시세|LIVE DEFAULT/);
  assert.match(app, /REQUEST_COOLDOWN_MS/);
  assert.doesNotMatch(app, /hasUsableQuote/);
  assert.match(guard, /requestedAt = Math\.max\(memoryAt, storedAt\)/);
  assert.match(app, /10초 중복 조회 방지 대기 중입니다/);
  assert.match(app, /refreshMarket\(\{ trigger: "load" \}\)/);
  assert.match(app, /fetchYahooSnapshot\(fetch, requestedAt, \{ timeoutMs: REQUEST_DEADLINE_MS \}\)/);
  assert.match(app, /trigger !== "button" && shouldPreferLocalArchive\(requestedAt\)/);
  assert.match(app, /selectBestSnapshotCandidate/);
  assert.match(app, /fetchLocalNasdaqSnapshot\(fetch\)/);
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
  assert.match(app, /5분봉 1개 결손 · H\/L\/현재가·시각은 공급자 메타와 교차검증, 시가는 첫 세션봉 기준 · ATR은 결손 이후 연속 완료봉으로 재계산/);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  assert.match(scheduleExpiry, /if \(!state\.snapshot \|\| !state\.assessment\?\.displayable\) return/);
  assert.match(scheduleExpiry, /if \(state\.assessment\.referenceOnly\) \{[\s\S]*window\.setTimeout\([\s\S]*renderMarket\(\)[\s\S]*60_000[\s\S]*return/s);
  assert.match(app, /if \(!assessment\.usable\) \{[\s\S]*scheduleExpiryCheck\(\)[\s\S]*setCalculationLock\(true, lockReason\)/s);
  assert.match(app, /visibilitychange/);
  assert.match(app, /actualContractConfirmed: true/);
  assert.match(app, /withExclusiveRequest/);
  assert.match(app, /A wall-clock rollback must not turn the request guard into a bypass/);
  assert.doesNotMatch(app, /positionAtrBinding|source: "user-fixed"|isValidAtrBinding/);
  assert.doesNotMatch(app, /Number\.isFinite\(Number\(state\.autoAtr\)\)/);
  assert.doesNotMatch(app, /populateManual/);
  assert.match(policy, /MAX_SOURCE_AGE_MINUTES = 25/);
  assert.match(policy, /NQ 대체 연속선물은 MNQ가 아니므로 자동 계산이나 이전값 미리보기에 사용하지 않습니다/);
  assert.match(policy, /requested === "MNQ=F" && returned === "MNQ=F"/);
  assert.match(policy, /provider\.tier === "mnq-continuous-proxy"/);
  assert.doesNotMatch(policy, /provider\.tier === undefined/);
  assert.match(policy, /MNQ=F로 검증되지 않은 종목·출처 응답이어서 계산과 이전값 미리보기를 중지합니다/);
  assert.match(policy, /새 기준을 검증·반영하기 전에는 계산을 중지합니다/);
  assert.match(policy, /현재 주간 기준을 최근 세션 시가에 환산한 읽기 전용 참고선/);
  assert.match(app, /이전 값으로 자동 계산하지 않습니다/);
  assert.doesNotMatch(app, /setInterval\s*\(/);
});

test("Service Worker가 Volatility 필수 자산과 오프라인 탐색을 포함한다", () => {
  const sw = read("sw.js");
  assert.match(sw, /v3\.11\.2-university-reports-s30\.1-admission-/);
  assert.match(sw, /const UNIVERSITY_ADMISSION_RELEASE = "[0-9a-f]{64}"/);
  for (const asset of [
    "./apps/volatility/index.html", "./apps/volatility/styles.css",
    "./apps/volatility/js/app.js", "./apps/volatility/js/calculator.js",
    "./apps/volatility/js/weekly-reference.generated.js",
    "./apps/volatility/js/market-provider.js", "./apps/volatility/js/local-market-provider.js",
    "./apps/volatility/js/request-guard.js", "./apps/volatility/js/snapshot-policy.js",
    "./apps/volatility/data/local-nasdaq-snapshot.json"
  ]) assert.ok(sw.includes(`"${asset}"`), asset);
  assert.match(sw, /request\.url\.includes\("\/apps\/volatility\/"\)/);
  assert.match(sw, /const cached = await caches\.match\(request\);\s*if \(cached\) return cached;/);
  assert.match(sw, /new Request\(asset, \{ cache: "reload" \}\)/);
  assert.match(sw, /local-nasdaq-snapshot\.json[\s\S]*new Request\(request, \{ cache: "no-store" \}\)/);
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
