# Personal Tap v2

GitHub Pages에 그대로 올릴 수 있는 **빌드 과정 없는 Vanilla HTML PWA 개인 앱 허브**입니다.

이 버전에서는 기존 MKAT 98 훈련 앱을 Repository 루트에서 분리해 `apps/mensa/` 하위 앱으로 이동했고, 설치 시 처음 열리는 화면을 **Personal Tap 메인 허브**로 변경했습니다.

## 핵심 구조

```text
.
├── index.html                 # Personal Tap 메인 화면
├── hub.css                    # 메인 화면 스타일
├── hub.js                     # 앱 카드·PWA 설치·상태 표시
├── apps.js                    # 연결할 앱 목록
├── manifest.webmanifest       # Personal Tap PWA 설정
├── sw.js                      # 허브와 하위 앱 공통 오프라인 캐시
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── apps/
    └── mensa/
        ├── index.html         # MKAT 98 앱
        ├── app.js
        ├── styles.css
        ├── question-bank.js
        ├── data/
        ├── docs/
        └── tests/
```

## 현재 연결된 카드

- **MKAT 98**: Repository 내부의 `./apps/mensa/`
- **Diary for my Wife**: 기존 GitHub Pages 주소
- **TouchBebe**: 준비 중 카드
- **YML Studio**: 준비 중 카드
- **새 앱 연결**: 다음 앱을 위한 빈 슬롯

`Diary for my Wife` 주소를 사용하지 않을 경우 `apps.js`에서 해당 항목을 삭제하거나 수정하면 됩니다.

## 앱 하나 더 연결하기

`apps.js`의 배열에 아래 객체를 추가합니다.

```js
{
  id: "my-new-app",
  title: "새 앱 이름",
  subtitle: "짧은 분류",
  description: "카드에 표시할 설명",
  href: "./apps/my-new-app/",
  icon: "🛠️",
  badge: "LIVE",
  enabled: true,
  external: false,
  accent: "mint"
}
```

사용 가능한 `accent` 값은 `violet`, `rose`, `mint`, `amber`입니다.

외부 사이트라면 `href`에 전체 주소를 넣고 `external: true`를 지정합니다. 아직 연결하지 않을 카드라면 `enabled: false`로 둡니다.

## MKAT 98 통계 연동

Personal Tap 메인 화면은 MKAT 98이 저장하는 `localStorage`의 `mkat98-stats-v1` 데이터를 읽어 다음 정보를 카드에 표시합니다.

- 오늘 푼 문제 수
- 누적 정확도
- 연속 학습일

두 화면이 같은 GitHub Pages 도메인에서 실행되므로 별도의 서버나 데이터베이스가 필요하지 않습니다.

## 로컬 실행

Service Worker는 `file://`에서 작동하지 않으므로 프로젝트 루트에서 서버를 실행합니다.

```bash
python -m http.server 8080
```

브라우저에서 아래 주소를 엽니다.

```text
http://localhost:8080
```

- Personal Tap: `http://localhost:8080/`
- MKAT 98: `http://localhost:8080/apps/mensa/`

## GitHub Pages 배포

1. 이 폴더 안의 파일과 폴더를 새 Repository 루트에 올립니다.
2. GitHub의 **Settings → Pages**로 이동합니다.
3. `Deploy from a branch`를 선택합니다.
4. `main` 브랜치와 `/ (root)`를 선택한 뒤 저장합니다.
5. 생성된 HTTPS 주소를 휴대전화에서 엽니다.
6. 브라우저 메뉴의 **홈 화면에 추가** 또는 화면의 **앱 설치** 버튼을 사용합니다.

모든 내부 경로는 상대경로로 작성되어 있어 `https://사용자명.github.io/Repository명/` 형태에서도 동작합니다.

## 문제은행 검증

```bash
node apps/mensa/tests/validate-bank.mjs
```

## Service Worker를 수정했을 때

`sw.js` 첫 줄의 캐시 이름을 올려야 기존 설치본이 새 파일을 즉시 받습니다.

```js
const CACHE_NAME = "personal-tap-v2.0.1";
```

## 다음 확장 아이디어

- Personal Tap 자체의 앱 편집 화면
- 앱별 최근 사용 순서 자동 정렬
- Supabase를 이용한 기기 간 설정·기록 동기화
- 일정, 가족 기록, 육아 도구를 한 화면에 요약
- 잠금 화면 또는 PIN 보호
