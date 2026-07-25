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
├── pwa-update.css             # 공통 PWA 업데이트 배너
├── pwa-update.js              # 대기 중인 업데이트 적용 제어
├── manifest.webmanifest       # Personal Tap PWA 설정
├── sw.js                      # 허브와 하위 앱 공통 오프라인 캐시
├── package.json               # 빌드 없는 검증·생성 명령
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── apps/
    └── mensa/
        ├── index.html         # MKAT 98 앱
        ├── styles.css
        ├── js/
        │   ├── app.js
        │   ├── bank-loader.js
        │   ├── indexeddb-repository.js
        │   ├── random.js
        │   ├── session-engine.js
        │   ├── stats-model.js
        │   └── training-store.js
        ├── data/
        │   ├── question-bank.json
        │   └── answer-key.csv
        ├── docs/
        ├── tests/
        └── tools/
```

런타임은 여전히 빌드 과정이나 외부 라이브러리가 필요하지 않습니다.
`package.json`은 문제은행 생성·검증과 자동 테스트 명령만 제공합니다.

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

MKAT 98의 상세 응시·세션 기록은 IndexedDB의 `mkat98-training-v2`에 저장됩니다.
이 데이터베이스가 사실 원본이며, Personal Tap 허브가 빠르게 읽는
`mkat98-summary-v2` localStorage 값은 언제든 다시 만들 수 있는 요약 캐시입니다.

- 오늘의 고유 문제 목표 진행도
- 누적 정확도
- v2부터 정확히 집계한 목표 완주 연속일

기존 `mkat98-stats-v1` 기록은 최초 실행 시 원문 그대로 IndexedDB에 백업하고,
과거 연습일만 복원합니다. 과거 목표 완주일은 추정하지 않습니다.
MKAT의 **데이터 내보내기** 버튼으로 상세 기록과 복구 저널을 JSON으로 보관할 수 있습니다.

각 세션은 문제별 실제 보기 순서와 셔플 버전을 함께 저장합니다. 앱을 닫거나
새로고침해도 호환되는 문제은행이면 같은 문제·보기 순서·풀이시간으로 이어서
풀 수 있습니다. 문제 내용이나 정답 버전이 달라졌다면 기존 답안은 보관하되
세션을 조용히 새 문제로 바꾸지 않습니다.

저장소와 이전 규칙의 상세 계약은
[`apps/mensa/docs/storage-model.md`](./apps/mensa/docs/storage-model.md)에 정리되어 있습니다.

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

`apps/mensa/data/question-bank.json`이 문제은행의 유일한 원본입니다.
브라우저는 이 JSON을 직접 불러오고, `answer-key.csv`는 JSON에서 자동 생성합니다.

문제은행을 수정한 뒤에는 다음을 실행합니다.

```bash
npm run sync:bank
npm test
npm run test:browser
```

Foundation 검증은 필수 데이터 오류를 실패로 처리하고, 아직 작성하지 않은
선택지별 피드백·구조화 해설·다차원 난이도·힌트는 품질 경고로만 표시합니다.

`npm run test:browser`는 Chromium 기반 헤드리스 브라우저에서 기존 훈련 모드,
v1 안전 이전, IndexedDB 응시 이벤트, v2 요약 캐시, JSON 로드와 PWA
오프라인 실행을 함께 확인합니다.

## PWA 업데이트

`sw.js`의 `CACHE_NAME`을 올리면 새 Service Worker가 설치 후 대기합니다.
앱은 **새 버전이 준비되었습니다** 배너를 표시하며, 사용자가 업데이트 버튼을
눌렀을 때만 새 버전을 활성화하고 한 번 새로고침합니다.

Service Worker는 현재 앱 scope의 동일 출처 요청만 처리하며,
`personal-tap-`으로 시작하는 이전 캐시만 정리합니다.

## 다음 확장 아이디어

- Personal Tap 자체의 앱 편집 화면
- 앱별 최근 사용 순서 자동 정렬
- Supabase를 이용한 기기 간 설정·기록 동기화
- 일정, 가족 기록, 육아 도구를 한 화면에 요약
- 잠금 화면 또는 PIN 보호
