# MKAT 98 저장·통계 모델 v2

## 원본과 캐시

- IndexedDB `mkat98-training-v2`가 상세 기록의 사실 원본입니다.
- localStorage `mkat98-summary-v2`는 Personal Tap 허브용 요약 캐시입니다.
- 앱을 시작할 때 요약 캐시는 IndexedDB와 이전 메타데이터에서 다시 생성됩니다.
- localStorage 요약 쓰기가 실패해도 성공한 IndexedDB 응시 트랜잭션은 취소하지 않습니다.
- `mkat98-recovery-v2`는 IndexedDB 장애 시에만 쓰는 임시 복구 저널입니다.

## IndexedDB 저장소

```text
attempts             응시 이벤트 원본
sessions             세션 시작·진행·완료 상태
questionProgress     후속 숙달 엔진용 파생 상태
meta                 설정, 이전 상태, 문제은행 정보, revision
```

`questionProgress`는 schema에만 준비되어 있으며 숙달·복습 전이는 다음 단계에서
구현합니다. 현재 통계는 `attempts`에서 다시 계산합니다.

## 응시 이벤트

```js
{
  attemptId,
  sessionId,
  questionId,
  contentVersion,
  bankVersion,
  mode,
  localDate,

  selectedOptionId,
  presentedOptionIds,
  optionSeed,
  shuffleVersion,

  correct,
  firstPass,
  retry,
  hintUsed,
  elapsedMs,
  overtime,
  skipped,

  inferredErrorTag,
  presentedAt,
  submittedAt,

  eligibleForDailyGoal,
  eligibleForMastery,
  eligibleForAbilityStats,
  eligibleForSpeedStats
}
```

`elapsedMs`는 현재 페이지에서 `performance.now()`의 차이로 측정하고,
`presentedAt`과 `submittedAt`은 재실행 후에도 비교할 수 있도록 `Date.now()` 값을
저장합니다.

## 선택지 순서와 세션 복원

- 새 세션마다 문제별 `optionSeed`와 `shuffleVersion`을 생성합니다.
- 실제 표시한 ID 배열인 `presentedOptionIds`도 함께 저장합니다.
- 복원할 때는 실제 ID 배열을 우선하고, 배열이 없는 구버전 자료에서만 seed로
  다시 계산합니다.
- 셔플 결과가 우연히 원본 순서와 같으면 결정적으로 한 칸 회전해 실제 위치가
  바뀌도록 합니다.
- 세션에는 각 문제의 `contentVersion`과 전체 `bankVersion`을 저장합니다.
- 채점 의미가 바뀌었는지 이중 확인할 수 있도록 문제별
  `gradingFingerprint`도 저장합니다.
- `bankVersion`만 바뀌고 모든 문제의 ID·`contentVersion`·보기 집합이 같다면
  그대로 복원합니다.
- 문제·정답·보기 구성이 달라졌다면 세션을 `invalidated`로 보관하고 새 내용으로
  조용히 교체하지 않습니다.
- 페이지 전환 중 늦게 끝난 저장이 새 상태를 덮지 않도록 세션별
  `sessionRevision`을 비교하고 더 최신 상태만 원자적으로 저장합니다.

진행 중 문제의 시계는 정밀한 현재 페이지 구간과 누적 시간을 나눠 저장합니다.
페이지가 숨겨지면 일시정지 상태를 저장하고, 저장 전에 브라우저가 종료된
경우에는 마지막 `runningSince` 이후 wall-clock 구간을 반영한 뒤 홈의 복원
대기 화면에서 다시 멈춥니다.

## 일일 목표와 연속일

- 기본 목표는 서로 다른 유효 문제 10개입니다.
- 같은 문제의 즉시 재도전은 목표에 다시 포함하지 않습니다.
- v1의 `solvedByDate`는 연습일 확인에만 사용합니다.
- v1 횟수만으로 서로 다른 문제 완주 여부를 알 수 없으므로 과거 목표 완주일은 만들지 않습니다.
- 목표 완주 연속일은 v2 응시 이벤트가 쌓인 날짜부터 계산합니다.
- 기존 `streak`은 `legacyStreak`으로 백업하지만 공식 연속일에는 합산하지 않습니다.

## v1 이전

최초 실행 시 다음 자료를 `meta`에 한 번만 저장합니다.

- 원본 문자열과 파싱 결과
- 정규화한 누적 통계
- `solvedByDate > 0`인 과거 연습일
- 기존 `legacyStreak`
- 이전 완료 시각과 당시 `bankVersion`

기존 localStorage 값은 자동 삭제하지 않습니다. 사용자가 **기록 초기화**를
명시적으로 승인한 경우에만 v1 값과 v2 데이터베이스를 함께 초기화합니다.

## 실패와 복구

응시 이벤트, 세션 상태, revision은 하나의 IndexedDB 트랜잭션으로 저장합니다.
트랜잭션이 실패하면 같은 `attemptId`를 가진 이벤트를 복구 저널에 기록합니다.
다음 앱 시작 시 `put`으로 재처리하므로 같은 이벤트가 중복 저장되지 않습니다.

IndexedDB 자체를 열 수 없는 환경에서는 메모리 저장과 복구 저널로 앱을 계속
사용할 수 있지만 화면에 경고를 표시합니다.

## 데이터 내보내기

내보낸 JSON에는 다음이 포함됩니다.

- 네 IndexedDB 저장소 전체
- 현재 통계 요약
- 적용 중인 `bankVersion`
- 저장소 상태
- 아직 처리하지 못한 복구 저널

Supabase 동기화는 이 로컬 계약이 안정된 이후 별도 단계에서 추가합니다.
