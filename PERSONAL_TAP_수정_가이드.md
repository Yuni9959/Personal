# Personal Tap 수정 가이드

> 대상: `C:\Users\tmddb\Desktop\남표니\멘사 준비\personal-tap-v2\personal-tap-v2`
>
> 기준: 2026-08-14, `main`, 요청형 지연 시세 릴리스 `v3.0.0-on-demand-delayed.1`
>
> 성격: Personal Tap 허브·Mensa·Volatility를 안전하게 수정하기 위한 파일 지도와 검증 절차

## 1. 가장 먼저 확인할 것

이 폴더가 `멘사 준비` 아래의 유일한 활성 Git 저장소다. 다음 항목은 참고본이므로
여기에 새 기능을 구현하지 않는다.

- `mensa-pwa-starter-v1/`
- `personal-tap-v2.zip`
- 각종 backup ZIP
- `.tmp/`

작업을 시작할 때 다음 순서로 현재 상태를 확인한다.

```powershell
Set-Location -LiteralPath 'C:\Users\tmddb\Desktop\남표니\멘사 준비\personal-tap-v2\personal-tap-v2'
Get-Content -LiteralPath '.\AGENTS.md' -Raw -Encoding UTF8
Get-Content -LiteralPath '.\README.md' -Raw -Encoding UTF8
Get-Content -LiteralPath '..\..\README.md' -Raw -Encoding UTF8
git status --short --branch
git log -5 --oneline --decorate
```

현재 원격은 `https://github.com/Yuni9959/Personal.git`, 배포 주소는
`https://yuni9959.github.io/Personal/`이다.

## 2. 전체 구조

```text
.
├── index.html                    # Personal Tap 허브의 정적 뼈대
├── apps.js                       # 카드 목록과 카드별 설정
├── hub.js                        # 카드 생성, 최근 사용, MKAT 요약, PWA 설치
├── hub.css                       # 320px~desktop 3열 고정, 모바일 압축형 스타일
├── manifest.webmanifest          # 설치형 PWA 메타데이터
├── sw.js                         # 허브·하위 앱 공통 오프라인 cache
├── pwa-update.js/.css            # 사용자가 승인하는 업데이트 배너
├── package.json                  # 생성·검증·시세 갱신 명령
├── .github/workflows/
│   └── deploy-pages.yml          # 시세 갱신 후 GitHub Pages 배포
├── apps/
│   ├── mensa/                    # MKAT 98
│   └── volatility/               # MNQ Volatility 점검 앱
├── README.md                     # 현재 릴리스와 운영 설명
├── AGENTS.md                     # 작업 완료·검증·Git 규칙
└── PERSONAL_TAP_수정_가이드.md   # 지금 읽고 있는 파일
```

런타임은 빌드가 없는 Vanilla HTML/CSS/JavaScript다. `npm` 명령은 앱을 번들링하는
것이 아니라 문제은행 생성·계약 검증·브라우저 회귀 테스트에 사용한다.

## 3. 초기 허브를 수정하는 방법

### 3.1 `index.html`: 허브의 고정 영역

[`index.html`](./index.html)은 다음 영역만 직접 가진다.

- 상단 Personal Tap identity와 온라인·오프라인 badge
- 앱이 삽입되는 빈 `#appGrid`
- 환영 문구와 `TODAY'S FOCUS`
- 앱 연결 안내와 footer
- 로드 순서: `apps.js` → `hub.js` → `pwa-update.js`

앱 카드를 추가하려고 `index.html`에 카드 HTML을 직접 복사하지 않는다. 카드 데이터는
`apps.js`, 실제 DOM 생성은 `hub.js`가 담당한다.

### 3.2 `apps.js`: 앱 입구의 단일 목록

[`apps.js`](./apps.js)는 `window.PERSONAL_TAP_APPS` 배열을 제공한다. 새 앱은 다음
계약을 따라 한 객체로 추가한다.

```js
{
  id: "my-new-app",
  title: "새 앱 이름",
  subtitle: "짧은 분류",
  description: "한두 문장의 설명",
  href: "./apps/my-new-app/",
  icon: "🛠️",
  badge: "BETA",
  enabled: true,
  featured: false,
  external: false,
  accent: "mint",
  metric: null
}
```

필드 의미:

| 필드 | 역할 |
| --- | --- |
| `id` | 카드 식별자와 접근성 ID의 기반. 영문·숫자·`-`·`_` 사용 권장 |
| `title` | 카드 제목 |
| `subtitle` | 제목 위의 짧은 분류 |
| `description` | 카드 본문 설명 |
| `href` | 저장소 내부 상대경로 또는 외부 전체 URL |
| `icon` | 간단한 문자·emoji 아이콘 |
| `badge` | `TRAINING`, `LIVE`, `BETA`, `COMING SOON` 등 상태 |
| `enabled` | `true`면 `<a>`, `false`면 `aria-disabled`인 `<article>` |
| `featured` | 현재 MKAT처럼 강조 카드 높이 사용 |
| `external` | 새 탭과 `noopener noreferrer` 적용 여부 |
| `accent` | `violet`, `rose`, `mint`, `amber` |
| `metric` | 현재 특별 처리되는 값은 `mkat`, `volatility` |

`hub.js`가 `innerHTML`로 이 값을 조립하므로 `apps.js`는 저장소 소유자가 검토한 정적
문자열만 사용한다. URL query나 사용자 입력을 카드 설정에 그대로 넣지 않는다.

### 3.3 `hub.js`: 카드의 동작

[`hub.js`](./hub.js)의 책임은 다음과 같다.

- `apps.js` 배열을 읽어 활성·비활성 카드 렌더링
- 내부 링크와 외부 링크 분리
- 최근 연 앱을 `personal-tap-recent-v1` localStorage에 저장
- MKAT의 `mkat98-summary-v2` 요약 cache를 읽어 오늘 목표·정확도·연속일 표시
- v2 요약이 없을 때 `mkat98-stats-v1`의 존재만 안전하게 안내
- 현재 시각에 따른 인사와 날짜 표시
- `navigator.onLine` 기반 온라인·오프라인 badge
- `beforeinstallprompt`와 설치 버튼 처리

새 앱 전용 metric을 추가하려면 `renderApps()`의 metric 선택부와 테스트를 함께
수정한다. 앱의 상세 원본 데이터를 허브에서 직접 읽지 말고, 작고 재생성 가능한
요약 계약만 읽는 편이 안전하다.

### 3.4 `hub.css`: 전 화면 3열 카드 레이아웃

[`hub.css`](./hub.css)의 앱 grid는 320px 모바일부터 데스크톱까지 다음 3열을
유지한다.

```css
.app-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
```

- 데스크톱: 6개 카드가 3×2이며 설명·metric·badge·action을 모두 표시한다.
- `max-width: 960px`: 열 수는 3열 그대로이고 제목 크기만 조정한다.
- `max-width: 620px`: 3×2 압축형 입구가 된다. badge·subtitle·metric을 숨기고 아이콘·제목·짧은 설명·action을 남긴다.
- `max-width: 350px`: 3열을 유지하면서 gap·padding·글자 크기를 더 줄여 320px에서도 가로 overflow를 막는다.
- `index.html`은 앱 launcher를 welcome panel보다 먼저 배치해 모바일 첫 화면에서 여섯 입구를 빠르게 찾게 한다.

카드에 필드를 늘릴 때 확인할 것:

- 긴 제목과 설명이 데스크톱 3열에서 잘리지 않는가
- 320px·390px에서 카드가 3×2로 유지되고 가로 overflow가 없는가
- 모바일 viewport 안에 여섯 카드가 먼저 보이는가
- 활성 카드의 `:focus-visible`이 보이는가
- 비활성 카드가 링크처럼 동작하지 않는가
- 최소 44px 터치 영역과 `prefers-reduced-motion` 처리가 유지되는가

## 4. PWA와 cache를 수정하는 방법

### 4.1 `sw.js`

[`sw.js`](./sw.js)의 현재 전체 PWA cache는
`personal-tap-v3.0.0-on-demand-delayed.1`이다. 허브 CSS URL의
`v2.9.0-three-column-grid.1`은 3열 레이아웃 자산 버전으로 별도 유지한다.
`index.html`의 `hub.css?v=2.9.0-three-column-grid.1`과 `CORE_ASSETS`의 동일 URL을
함께 유지해야 새 CSS와 cache key가 어긋나지 않는다.
`CORE_ASSETS`에는 허브, MKAT 필수 JS·문제은행, Volatility HTML·CSS·JS만
포함된다. 실제 시장 스냅샷은 공개 cache에 넣지 않는다.

다음 변경에는 `CACHE_NAME` 갱신을 검토한다.

- HTML, CSS, 실행 JS 또는 앱 데이터 계약 변경
- `CORE_ASSETS`에 새 파일 추가·삭제
- 오래된 cache가 새 코드와 호환되지 않는 변경

Service Worker의 정책:

- 현재 scope의 동일 출처 GET만 처리
- navigation은 network 우선, 실패하면 해당 하위 앱의 cached `index.html`
- 일반 정적 자산은 cache 우선 후 network 갱신
- `/api/*` 경로는 현재와 향후 모두 Service Worker cache에서 제외
- activate 시 `personal-tap-` prefix의 이전 cache만 정리
- 새 worker는 자동 강제 전환하지 않고 업데이트 배너의 사용자 선택으로 `SKIP_WAITING`

개발 중 `file://`로 열면 Service Worker를 시험할 수 없다. 반드시 로컬 HTTP 서버를
사용한다.

```powershell
python -m http.server 8080
```

### 4.2 `manifest.webmanifest`와 아이콘

- 허브 manifest: [`manifest.webmanifest`](./manifest.webmanifest)
- 허브 아이콘: `icons/icon-192.png`, `icons/icon-512.png`
- MKAT 아이콘: `apps/mensa/icons/`

앱 이름, 시작 URL, 색상이나 아이콘을 바꾸면 설치·업데이트·오프라인 브라우저 테스트를
함께 수행한다.

## 5. Mensa 앱 구조와 수정 경계

### 5.1 코드 지도

| 파일 | 책임 |
| --- | --- |
| [`apps/mensa/index.html`](./apps/mensa/index.html) | MKAT 화면과 mode 입구 |
| `apps/mensa/js/app.js` | 화면·사용자 흐름 조정 |
| `bank-loader.js` | 실행용 문제은행 로드와 schema 검사 |
| `session-engine.js` | 보기 셔플, timer, 세션 생성·복원 |
| `indexeddb-repository.js` | IndexedDB 트랜잭션·저장소 |
| `training-store.js` | v1 이전, 복구 journal, 내보내기, 허브 요약 cache |
| `mastery-engine.js` | 숙달 단계·복습일 규칙 |
| `daily-queue-engine.js` | 오늘의 10문제·최근 노출 균형 |
| `mode-policy.js` | 유형학습·일일·진단·실전·속도·복습 정책 |
| `analytics-model.js` | 상세 성과·오답 원인·추천 계산 |
| `stats-model.js` | 통계 요약 |
| `random.js` | 재현 가능한 seed 기반 무작위 |

### 5.2 저장 계약

- 사실 원본: IndexedDB `mkat98-training-v2`
- 허브용 재생성 가능 요약: localStorage `mkat98-summary-v2`
- 과거 기록: `mkat98-stats-v1`을 최초 이전 시 원문 그대로 백업
- 저장소: attempts, sessions, mastery, meta
- 진단·실전은 완료 시 응시 events와 session을 한 트랜잭션으로 저장
- 저장 실패는 복구 journal에 보존하고 다음 실행에서 중복 없이 재생

상세 내용은 [storage-model.md](./apps/mensa/docs/storage-model.md)를 먼저 읽는다.

### 5.3 문제은행 계약

현재 실행 문제은행은 59유형·990문제·6,298보기다.

- 기초 120
- 중복 제거 심화 232
- 고정된 300 원본 중 T26 제외 활성 288
- Mensa Norway 35개 원형 기반 독자 생성 S01~S35 350

`question-bank.json`과 `answer-key.csv`를 손으로 따로 고치지 않는다. 문항·보기·정답을
의도적으로 바꾸면 `contentVersion`, `gradingFingerprint`, 기존 session 호환성을 함께
검토하고 생성 도구와 전체 release 테스트를 사용한다.

관련 문서:

- [문항 작성 규칙](./apps/mensa/docs/authoring-guide.md)
- [저장·이전 계약](./apps/mensa/docs/storage-model.md)
- [유형 목록](./apps/mensa/docs/type-map.md)

관련 명령:

```powershell
npm run build:bank:check   # 파일을 바꾸지 않고 재현 확인
npm run build:bank         # 의도적인 문제은행 변경 때만 실행
npm run enrich:content     # 인지영역·해설·힌트·난이도 재생성
npm run validate:bank
```

## 6. Volatility 앱 구조와 수정 경계

### 6.1 코드 지도

| 파일 | 책임 |
| --- | --- |
| [`apps/volatility/README.md`](./apps/volatility/README.md) | 계산·시세·P1~P7 운영 계약 |
| [`apps/volatility/docs/on-demand-delayed-data.md`](./apps/volatility/docs/on-demand-delayed-data.md) | 요청형 지연 시세 흐름·검증·한계·교체 지점 |
| [`apps/volatility/index.html`](./apps/volatility/index.html) | 평균·실전선·복기선·포지션·경고 UI |
| `apps/volatility/styles.css` | 반응형 카드와 상태 스타일 |
| `apps/volatility/js/calculator.js` | MNQ 계약값, 주간 기준, 가격선·손익·손절·P6/P7 계산 |
| `apps/volatility/js/market-provider.js` | Jina Reader 응답 검증, Chicago 세션, DST, O/H/L/current, 완료봉 ATR 재구성 |
| `apps/volatility/js/request-guard.js` | 일반 10초 cooldown·429 대기, 시계 rollback, 탭 간 단발 요청 잠금 |
| `apps/volatility/js/snapshot-policy.js` | 진행 세션 25분·완료 세션 96시간·주간 기준의 fail-closed 판정 |
| `apps/volatility/js/app.js` | 시작 캐시의 강제 읽기 전용 재검증, 진입·버튼 단발 조회, 완료 세션 referenceOnly와 수동 폴백 UI 잠금 |
| `apps/volatility/tests/*.test.mjs` | 계산·공급자·UI·허브·PWA·workflow 계약 |

### 6.2 반드시 분리할 세 수치

1. 평균 전체범위 `(H-L)/O`: 양봉 1.757859%, 음봉 1.968778%. 범위 예산이지 가격선이 아니다.
2. 실전 ex-ante q25: 상승 +0.359538%, 하락 -0.295051%. 종가 방향을 모를 때 기본 표시한다.
3. 사후 조건부 q25: 양봉 상방 +0.707994%, 음봉 하방 -0.815283%. 복기용이며 장중 기본선이 아니다.

`도달률`을 `거래 성공률`, `승률`, `목표가 도달 확률`, `기대수익`으로 바꾸지 않는다.
시가·고가·저가만으로는 도달 순서, 진입, 손절, 비용을 알 수 없다.

### 6.3 MNQ 계산 계약

- 계약 승수: `$2/point`
- 최소호가: `0.25 point`
- 실전 상방선: `open × (1 + exAnteUp/100)`, 더 멀어지지 않게 tick 아래로
- 실전 하방선: `open × (1 - exAnteDown/100)`, 더 멀어지지 않게 tick 위로
- 손절: 진입가에서 `1.0 × 완료 5분 Wilder ATR(14)`
- 수수료: 사용자가 입력한 총액을 한 번만 차감
- 포지션 표시: 임계선 시나리오, 통계적 기대수익이 아님

주간 값의 근거 파일은
`C:\Users\tmddb\Desktop\승윤재테크\Volatility_안전측검증_20260813\data\12_app_contract.json`이다.
현재 앱의 실행 상수는 `calculator.js`에 있으므로 다음 월요일에 자동 갱신되지 않는다.
분석 재실행 → contract 비교 → 상수·설명·테스트 갱신 → cache bump 순서로 작업한다.

### 6.4 시세 공급

화면 최초 진입 또는 사용자가 버튼을 누를 때만 Jina Reader를 거쳐 Yahoo
Finance chart의 `MNQ=F` 최근 5일치 5분봉을 한 번 조회한다. 일반 10초
cooldown 동안 반복 요청을 막고, 429는 최소 60초·최대 15분을 별도로 지킨다.
예약·주기·백그라운드 갱신은 하지 않는다. MNQ 응답이 데이터 없음이거나
오류면 계산에 쓸 수 없는 NQ를 추가 조회하지 않고 즉시 잠근다. 최신 봉이
속한 `America/Chicago` 17:00~익일 16:00 세션을
DST-aware로 잘라 O/H/L/current와 완료봉 ATR을 만든다.

```powershell
npm run test:volatility
```

실제 Yahoo 시세를 담은 정적 파일과 갱신 도구는 공개 재배포를 피하려고 제거했다.
Jina 외부 envelope와 Yahoo 내부 JSON에는 각각 512 KiB 상한을 적용하고,
canonical 원본 URL, FUTURE/CME/USD/5분, 반환심볼, 원천시각, 세션 5분봉 연속성,
OHLC와 0.25 tick을 검증한다. 진행 세션은 원천시각이 25분을 넘거나 미래이거나
NQ 대체값, 429·CORS·검증 오류이면 자동 계산을 잠근다. 완료 세션은 종료 전
마지막 5분까지 관측되고 96시간 이내이며 같은 weekly 기준 기간일 때만
`referenceOnly`로 복원한다. 이 참고값은 가격표 검토에만 쓰고 ATR·포지션·손절
계산에는 전달하지 않는다. 잠긴 이전값을 수동값으로 승격하지 않으며 수동 입력
패널은 기본적으로 닫아 둔다.

Yahoo endpoint는 공식 거래소 피드도 무지연 피드도 아니며 브라우저 CORS를
보장하지 않는다. 공식 안내상 CME는 약 10분 지연이다. 화면은 `실시간`이라는
표현 대신 요청시각·원천 가격시각·지연·계산 잠금·수동 상태를 보여야 한다.
실제 주문 전에는 증권사 MNQ 실제 월물과 대조한다. 상세 계약은
[`on-demand-delayed-data.md`](./apps/volatility/docs/on-demand-delayed-data.md)를
참조한다.

### 6.5 P1~P7 표시의 한계

- P6 `High Vol AND Bearish Regime`: 실증 표본이 각 1건뿐이어서 shadow 경고만 허용
- OR kill switch: 과잉차단으로 hard kill 기각, 비활성 비교용
- P7: 직접 관리 로그가 없어 사용자 입력 기반 미검증 안전 알림
- P1~P5: 신뢰할 수 있는 실제 월물 다중 주기 데이터와 누출 방지 검증 전에는 자동분류하지 않음

## 7. 테스트 명령과 현재 기준

### 7.1 가장 중요한 전체 검증

```powershell
npm run test:release
```

2026-08-14 재검증 기준:

- Mensa·공통 Node `73/73`
- Volatility `69/69`
- 총 Node `142/142`
- 문제은행 59유형·990문제·6,298보기, 오류 0, 품질 경고 0
- answer-key 990개 일치
- Chromium에서 허브 6카드, desktop·390px·320px 모두 3열, 모바일 3×2, MKAT·Volatility offline load 성공

### 7.2 부분 검증

```powershell
npm test                    # Node 계약 전체
npm run test:volatility     # Volatility 계산·UI·workflow
npm run test:browser        # Chromium·IndexedDB·PWA·반응형 smoke
npm run build:bank:check    # 문제은행 재현성, 쓰기 없음
npm run validate:bank       # content-complete 품질
```

화면 변경은 Node 테스트만으로 끝내지 않는다. `npm run test:browser`와 데스크톱·390px·320px
스크린샷을 확인하고 가로 overflow, 버튼 focus, offline navigation을 직접 본다.

## 8. GitHub Pages 배포

[`deploy-pages.yml`](./.github/workflows/deploy-pages.yml)은 다음 때 실행된다.

- `main` push
- 수동 `workflow_dispatch`

workflow 순서:

1. checkout
2. Node 22에서 `npm run test:release` 전체 회귀·Chromium·오프라인 검증
3. 정적 `_site` 구성
4. Pages artifact 업로드
5. GitHub Pages 배포

Repository의 **Settings → Pages → Source**는 **GitHub Actions**여야 한다.
workflow는 시장데이터를 요청하지 않는다. 시세 요청은 Volatility 페이지 진입
또는 버튼 클릭에서만 발생하며, 실패 시 이전 표본을 새 값으로 가장하지 않는다.

## 9. 변경 종류별 파일 지도

| 하고 싶은 일 | 먼저 볼 파일 | 함께 확인할 것 |
| --- | --- | --- |
| 허브 카드 추가·순서 변경 | `apps.js` | `hub.js`, desktop·390px·320px 3열 browser smoke |
| 허브 문구·고정 layout 변경 | `index.html`, `hub.css` | 접근성 ID, 모바일 3×2, 가로 overflow, cache 이름 |
| 카드 metric 변경 | `hub.js` | localStorage 계약과 테스트 |
| PWA 필수 파일 추가 | `sw.js` | `CORE_ASSETS`, `CACHE_NAME`, offline smoke |
| 설치 이름·아이콘 변경 | `manifest.webmanifest`, `icons/` | install·update 실제 기기 점검 |
| MKAT 문제 수정 | `apps/mensa/docs/authoring-guide.md`와 source | fingerprint, build, answer key, release test |
| MKAT 저장 방식 수정 | `storage-model.md`, repository/store | v1 이전, recovery, transaction, IndexedDB tests |
| 오늘의 10문제 변경 | `daily-queue-engine.js` | 같은 날 고정, 10개 고유 유형, 30일 균형 |
| Volatility 기준 갱신 | 분석 `12_app_contract.json`, `calculator.js` | README, UI 계약, q25와 평균 분리, cache bump |
| 시세 요청·세션·ATR 변경 | `on-demand-delayed-data.md`, `market-provider.js`, `app.js` | 단발 요청, cooldown, Chicago DST, 완료봉, NQ 계산 잠금 |
| P6/P7 경고 변경 | `calculator.js`, UI, P1~P7 보고서 | shadow/비활성/미검증 상태 유지 |
| 배포 갱신 | workflow | secret-free, 예약 시세 호출 없음, Pages run 확인 |

## 10. 작업 완료 규칙

저장소의 [AGENTS.md](./AGENTS.md)가 최우선 작업 절차다. 일반적인 변경 완료 흐름은
다음과 같다.

1. 현재 `git status`, README와 최근 이력을 확인한다.
2. 관련 없는 사용자 변경과 `.tmp`, ZIP, 생성 임시물을 보존한다.
3. 활성 저장소에서만 필요한 파일을 수정한다.
4. 관련 README와 저장소 밖 `../../README.md`의 상태·완료·다음 작업을 실제 결과로 갱신한다.
5. `npm run test:release`와 필요한 추가 검증을 실행한다.
6. `git diff --check`, `git diff`, `git status`를 확인한다.
7. 현재 작업 파일만 명시적으로 stage한다.
8. Conventional Commit으로 commit하고 현재 branch를 push한다.
9. GitHub Pages workflow와 실제 URL을 확인한다.

단, 사용자가 특정 작업에서 commit·push를 금지하면 그 지시가 우선한다. 조회·진단만 한
작업에도 commit을 만들지 않는다.

## 11. 흔한 실수

- 바깥 ZIP이나 starter를 수정하고 활성 저장소를 그대로 두는 것
- `apps.js` 대신 `index.html`에 카드 HTML을 중복 작성하는 것
- 외부 링크에 `external: true`를 빼는 것
- 새 정적 파일을 만들고 `sw.js`의 asset·cache version을 확인하지 않는 것
- `file://`로 열고 PWA가 동작하지 않는다고 판단하는 것
- `question-bank.json`과 `answer-key.csv`를 서로 다르게 수동 수정하는 것
- IndexedDB 사실 원본을 localStorage 요약으로 대체하는 것
- 평균 `(H-L)/O`를 시가 목표선으로 표시하는 것
- 조건부 양봉·음봉 선을 장중 ex-ante 예측처럼 표시하는 것
- 도달률을 거래 성공률이나 기대수익으로 바꾸는 것
- 지연 연속선물 프록시를 실제 MNQ 월물 실시간 시세라고 표시하는 것
- P6/P7의 표본 한계를 숨기고 자동 차단을 활성화하는 것
- test 통과 전에 README 상태나 배포 완료를 먼저 선언하는 것

## 12. 참고 문서 우선순위

1. [AGENTS.md](./AGENTS.md) — 작업·검증·Git 규칙
2. [README.md](./README.md) — 현재 릴리스·구조·명령·다음 작업
3. `../../README.md` — `멘사 준비` 전체 인수인계와 활성 저장소 위치
4. [Volatility README](./apps/volatility/README.md) — 계산·시세·P1~P7 계약
5. [Mensa storage model](./apps/mensa/docs/storage-model.md) — IndexedDB·이전·복구
6. [Mensa authoring guide](./apps/mensa/docs/authoring-guide.md) — 문항 작성·검산
7. [Mensa type map](./apps/mensa/docs/type-map.md) — 59개 유형 구조
8. `C:\Users\tmddb\Desktop\승윤재테크\작업기록_텔레그램_Codex_Volatility_20260814.md` — 분석·보고서·Telegram 브리지 전체 작업 기록
