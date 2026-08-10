# 문제 제작 가이드

## 1. 소스와 실행용 문제은행을 구분한다

브라우저는 `data/question-bank.json`만 읽지만 이 파일은 병합 결과물입니다.
심화 원본은 `data/advanced-question-bank-v1.json`, 신규 300문항 원본은
`data/sources/mkat-original-300-v1.json.gz`에 보존하고 manifest의 SHA-256으로
무결성을 확인합니다. Mensa Norway 35개 원형 기반 신규 350문항은
`data/sources/mkat-mensano-350-v1.json.gz`에 원본 스키마 4 그대로 보존하고,
빌드 중 앱 스키마 2와 전역 보기 ID 계약으로 정규화합니다.
`npm run build:bank`가 소스들을 병합해 실행용 JSON과 `answer-key.csv`를
만듭니다.

`question-bank.js` 같은 실행용 사본을 별도로 만들지 않습니다.

## 2. 한 문제에 한 개의 정답만 존재해야 한다

보기의 시각적 차이가 작더라도 데이터 수준에서는 중복되지 않아야 합니다.
유형 ID가 달라도 자극 SVG와 보기 콘텐츠 묶음이 완전히 같으면 중복으로
판정합니다.
새 문제를 추가한 뒤 반드시 `content-complete` 검증과 자동 테스트를 실행합니다.

## 3. 정답은 보기 순서와 분리한다

모든 옵션은 문제 안에서 바뀌지 않는 ID를 가집니다.

```json
{
  "id": "T06-03-O1",
  "svg": "..."
}
```

문제는 `answerIndex` 대신 정답 옵션 ID를 저장합니다.

```json
{
  "correctOptionId": "T06-03-O4"
}
```

옵션을 재정렬하더라도 기존 ID를 바꾸거나 다른 옵션에 재사용하지 않습니다.

## 4. 문제 버전을 관리한다

- `bankVersion`: 문제은행을 배포할 때 올립니다.
- `contentVersion`: 해당 문제의 사용자 노출 내용이 바뀌면 올립니다.
- `gradingFingerprint`: 문제·자극·보기·정답·제한시간에서 자동 계산합니다.

맞춤법만 바꿔도 `contentVersion`은 올립니다. 문제나 보기 문구를 바꾸면
`gradingFingerprint`도 달라지며, 해설·함정 문구만 바꾼 경우에는 유지됩니다.

## 5. 오답은 실제 실수에서 만든다

좋은 오답은 무작위 모양이 아니라 다음과 같은 오류를 반영합니다.

- 개수만 맞고 방향이 틀림
- 색만 맞고 모양이 틀림
- 합집합 대신 XOR을 적용함
- 공통 요소를 제거하지 않음
- 한 선이나 한 면을 누락함
- 계산한 숫자와 비슷한 숫자를 잘못 누름

현재 `content-complete` 프로필에서는 모든 오답 보기에 `errorTag`와
선택지별 `feedback`이 있어야 합니다. 정답 보기의 두 필드는 `null`이어야
합니다. 태그는 문제은행 최상위 `errorTaxonomy`에 등록된 값만 사용합니다.

## 6. 설명은 규칙과 적용을 구분한다

모든 해설은 다음 세 필드를 가진 객체로 작성합니다.

```json
{
  "explanation": {
    "rule": "규칙을 한 문장으로 선언합니다.",
    "application": "해당 문제의 값에 규칙을 적용합니다.",
    "verification": "최종 답을 다른 방향으로 검산합니다."
  },
  "hints": [
    "첫 번째 힌트는 관찰 대상을 좁힙니다.",
    "두 번째 힌트는 적용 순서를 안내합니다."
  ]
}
```

힌트는 정답을 직접 말하지 않으며, 첫 단계보다 두 번째 단계가 더 구체적이어야
합니다. 힌트를 사용한 정답은 일일 목표에는 포함하지만 숙달·능력 통계에서는
제외합니다.

## 7. 난이도 기준

- 1: 단일 규칙, 요소 3개 이하
- 2: 단일 규칙, 보기 간 차이가 작음
- 3: 두 속성 또는 두 단계 연산
- 4: 서로 다른 주기·방향을 동시에 추적
- 5: 복합 규칙, 작업기억 부담, 강한 오답 유혹

`difficulty`는 다차원 프로필의 `overall`과 같아야 합니다. 프로필에는
`ruleSteps`, `attributeLoad`, `workingMemory`, `visualComplexity`,
`distractorSimilarity`, `timePressure`를 각각 1~5로 기록합니다.
원본 제작 난이도는 `sourceDifficulty`에 그대로 보존합니다. 신규 300문항의
3~8 제작자 척도도 런타임 1~5 척도로 정규화하되 원본 값은 잃지 않습니다.

## 8. 인지 영역과 점수 그룹

각 유형과 문항에는 `domainId`와 `scoreGroup`을 함께 둡니다.

- 인지 영역: 도형 규칙, 순서·다중속성, 공간 추론, 수리·등가, 개수·주의
- `core`: 핵심 추론 정확도에 포함
- `supplemental`: 별도 보조 지표로만 표시

T19 일반지식과 T26 네 글자 알파벳 변환형은 활성 문제은행에서 완전히
제외하며, 현재 T23 스트룹만 `supplemental`입니다.

## 9. SVG 안전성

`stimulusSvg`와 보기 SVG는 검토된 로컬 정적 데이터만 사용합니다.
외부 사용자 입력을 SVG에 삽입하지 않습니다.

검증기는 다음 요소를 오류로 처리합니다.

- `<script>`
- `<foreignObject>`
- `onload` 같은 이벤트 속성
- `javascript:` URL
- 외부 HTTP(S) `href`

## 10. 새 문제 또는 기존 문제 수정 절차

1. 해당 소스 문제은행을 편집하고 고정된 소스라면 manifest 해시도 갱신합니다.
2. 새 옵션에 문제 ID를 포함한 전역 고유 ID를 부여하고 `correctOptionId`를 지정합니다.
3. 문제 내용 변경 시 `contentVersion`을 올립니다.
4. 배포 단위가 바뀌면 `bankVersion`을 올립니다.
5. 프로젝트 루트에서 `npm run build:bank`를 실행합니다.
6. 인지 영역·피드백·해설 생성 규칙을 수정했다면
   `npm run enrich:content`를 실행합니다.
7. `npm test`를 실행합니다.
8. `npm run test:release`로 실제 Chromium과 오프라인 흐름을 확인합니다.
9. 모바일 폭 390px와 데스크톱에서 문제와 보기를 확인합니다.
10. 배포 시 `sw.js`의 `CACHE_NAME`을 올립니다.

`npm run sync:bank`는 `gradingFingerprint`를 다시 계산하고
`answer-key.csv`를 JSON과 동기화합니다.

`enrich:content`의 유형별 규칙은 `tools/enrich-content-v2.mjs`가 관리합니다.
이 도구는 반복 실행해도 결과가 같아야 하며, 채점 fingerprint를 바꾸는
변환을 거부합니다. 문제 자극·보기·정답을 의도적으로 바꾸는 작업은 먼저
검토한 뒤 `sync:bank`로 새 fingerprint를 확정하고 다시 전체 검증합니다.
