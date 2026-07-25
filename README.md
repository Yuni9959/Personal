# MKAT 98 훈련실

GitHub Pages에 그대로 올릴 수 있는 **빌드 과정 없는 Vanilla HTML PWA**입니다.

- 25개 추론 유형
- 유형별 오리지널 연습문제 5개
- 총 125문제
- SVG 기반 문제 그림
- 날짜별 오늘의 10문제
- 유형별 5문제 집중훈련
- 오답 다시 풀기
- 제한시간·시간초과 기록
- `localStorage` 기반 정확도·연속학습 기록
- Service Worker 기반 오프라인 실행

> 이 문제들은 사용자가 정리한 온라인 테스트의 **추론 원리와 능력 유형**을 바탕으로 새로 제작했습니다. 멘사코리아의 실제 입회시험 문제나 정답을 복제한 자료가 아닙니다.

## 바로 실행

서비스 워커는 `file://`에서 작동하지 않으므로 간단한 로컬 서버를 사용하세요.

```bash
python -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다.

## GitHub Pages 배포

1. 이 폴더의 모든 파일을 Repository 루트에 올립니다.
2. Repository의 Pages 설정에서 `main` 브랜치와 루트 폴더를 배포 대상으로 선택합니다.
3. 생성된 HTTPS 주소를 휴대전화에서 엽니다.
4. 브라우저 메뉴에서 홈 화면에 추가하면 독립형 앱처럼 실행됩니다.

모든 경로는 `./` 상대경로이므로 프로젝트 Repository 이름과 관계없이 GitHub Pages 하위 경로에서 동작하도록 작성했습니다.

## 파일 구조

```text
.
├── index.html
├── app.js
├── styles.css
├── question-bank.js
├── manifest.webmanifest
├── sw.js
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── data/
│   ├── question-bank.json
│   └── answer-key.csv
├── docs/
│   ├── type-map.md
│   └── authoring-guide.md
└── tests/
    └── validate-bank.mjs
```

## 문제 데이터 구조

각 문제는 다음 필드를 가집니다.

```js
{
  id: "T04-03",
  typeId: "T04",
  typeTitle: "선분 XOR·대칭차",
  difficulty: 3,
  prompt: "문제 지시문",
  stimulusSvg: "<svg>...</svg>",
  options: [
    { svg: "<svg>...</svg>" },
    { text: "18" }
  ],
  answerIndex: 2,
  explanation: "정답 근거",
  skills: ["XOR", "선분 분해"],
  trap: "자주 빠지는 함정",
  timeLimitSec: 45,
  originalPracticeItem: true
}
```

`answerIndex`는 0부터 시작합니다. 앱 화면에는 1번부터 표시됩니다.

## 문제은행 검증

Node.js가 설치되어 있다면 다음으로 개수·ID·정답 인덱스·보기 중복을 검사할 수 있습니다.

```bash
node tests/validate-bank.mjs
```

## 다음 개발 우선순위

1. 실제 사용자 풀이시간과 오답률을 이용한 난이도 재보정
2. 취약 태그별 적응형 출제
3. 36문항·30분 실전 모의고사
4. OMR 마킹 모드
5. 문제 제작기와 시드 기반 무한 변형
6. 기록 내보내기·가족 기기 간 동기화
