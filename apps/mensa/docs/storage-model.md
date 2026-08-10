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

`questionProgress`는 빠른 큐 생성을 위한 파생 상태입니다. 앱을 시작할 때
`attempts` 전체에서 다시 계산한 뒤 저장하므로 손상되거나 규칙 버전이 바뀌어도
응시 원본에서 복구할 수 있습니다.

## 숙달·복습 단계

| 단계 | 상태 | 유효 정답 | 오답 |
| ---: | --- | --- | --- |
| 0 | 신규 | 단계 1, 3일 뒤 | 단계 0, 다음 날 |
| 1 | 학습 중 | 단계 2, 7일 뒤 | 단계 0, 다음 날 |
| 2 | 안정화 중 | 단계 3, 21일 뒤 | 단계 1, 다음 날 |
| 3 | 숙달 | 단계 4, 45일 뒤 | 단계 2, 다음 날 |
| 4 | 유지 복습 | 단계 4, 60일 뒤 | 단계 2, 다음 날 |

유효 정답은 첫 제출, 힌트 미사용, 제한시간 내 제출, 즉시 재도전 아님,
직전 승급과 다른 날짜라는 조건을 모두 충족해야 합니다.

- 같은 날의 반복 정답은 기록하지만 다시 승급시키지 않습니다.
- 시간초과·힌트 정답은 단계를 올리지 않고 다음 날 복습시킵니다.
- 즉시 재도전은 `recoverySuccess`만 기록하며 원래 복습일을 취소하지 않습니다.
- 속도 훈련은 일반 숙달 단계를 변경하지 않습니다.
- 숙달 상태 저장은 응시·세션·revision과 같은 IndexedDB 트랜잭션에 포함됩니다.

## 적응형 일일 고정 큐

오늘의 큐는 처음 생성할 때 `meta.dailyQueues[localDate]`에 문제 ID,
`contentVersion`, 선정 이유와 전략 버전을 저장합니다.

전략 버전 2부터 10개 항목의 `typeId`는 모두 달라야 합니다. 복습 예정이나
취약 문제가 한 유형에 몰려도 그 유형에서는 한 문제만 선택하고 다음 유형으로
넘어갑니다.

전략 버전 3은 최근 6회 일일 큐에서 유형별 출제일 수와 마지막 출제일을
계산합니다. 최근에 덜 나왔고 누적 출제·응시 횟수가 적은 유형부터 선택해,
문항 수가 많은 유형이 단순히 후보를 더 많이 가진다는 이유로 자주 뽑히지
않게 합니다. 풀이를 완료하지 않은 날도 저장된 큐 이력으로 순환에 반영합니다.

콜드 스타트에서는 다음 순서로 채웁니다.

- 복습 예정 0~2개
- 복습 수만큼 조정한 미응시 유형 문제
- 노출이 적거나 오래전에 학습한 유형 2개
- 한 단계 높은 도전 2개
- 부족한 자리는 유형·응시 횟수를 고려한 균형 문제

능력 통계 시도가 20회 이상이고, 두 번 이상 측정된 유형이 6개 이상이면
적응형 구성으로 전환합니다.

```text
복습 예정 4 + 취약 유형 3 + 신규 문제 2 + 도전 문제 1
```

유형 표본이 두 번 미만이거나 최근 정확도가 80% 이상이면 취약으로 분류하지
않습니다. 취약 유형 사이에서도 최근 노출이 적은 유형을 우선합니다. 같은
날짜에는 통계가 바뀌어도 저장된 큐를 그대로 사용합니다. 각 항목은 `contentVersion`과
`gradingFingerprint`를 저장합니다. fingerprint가 같으면 해설·힌트 같은
콘텐츠 버전이 달라져도 같은 문제 ID를 유지하고, 정답 의미가 바뀌거나 문제
ID가 사라졌을 때만 해당 위치를 교체합니다. 구버전 항목에 fingerprint가
없으면 `contentVersion`을 안전한 대체 기준으로 사용합니다. 과거 저장 큐에
같은 유형이 여러 번 있으면 먼저 나온 항목을 보존하고 이후 중복 위치만 아직
사용하지 않은 유형으로 교체합니다. 최근 45일 큐만 보존합니다.

## 응시 이벤트

```js
{
  attemptId,
  sessionId,
  questionId,
  contentVersion,
  gradingFingerprint,
  bankVersion,
  typeId,
  domainId,
  scoreGroup,
  difficulty,
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

`typeId`, `domainId`, `scoreGroup`, `difficulty`는 응시 당시의 분석 문맥을
보존합니다. 과거 응시에 이 필드가 없으면 현재 문제은행의 같은 문제 ID에서
보완해 읽습니다. `inferredErrorTag`는 사용자가 고른 오답 보기의 표준 오류
태그이며, 첫 제출 오답 원인 분포에 사용합니다.

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
- `gradingFingerprint`가 같으면 `contentVersion`이 달라도 해설·힌트 변경으로
  간주해 그대로 복원합니다. fingerprint가 없는 구버전 세션에서만
  `contentVersion` 일치를 요구합니다.
- `bankVersion` 변경만으로는 세션을 무효화하지 않습니다.
- 문제·정답·보기 구성이 달라졌다면 세션을 `invalidated`로 보관하고 새 내용으로
  조용히 교체하지 않습니다.
- 페이지 전환 중 늦게 끝난 저장이 새 상태를 덮지 않도록 세션별
  `sessionRevision`을 비교하고 더 최신 상태만 원자적으로 저장합니다.

진행 중 문제의 시계는 정밀한 현재 페이지 구간과 누적 시간을 나눠 저장합니다.
페이지가 숨겨지면 일시정지 상태를 저장하고, 저장 전에 브라우저가 종료된
경우에는 마지막 `runningSince` 이후 wall-clock 구간을 반영한 뒤 홈의 복원
대기 화면에서 다시 멈춥니다.

힌트를 허용하는 세션은 문항별 공개 단계 1~2를 `hintLevels`에 저장합니다.
기존 `hintUsedQuestionIds`는 숙달 자격 판정과 구버전 복원에 계속 사용합니다.

평가형 세션은 다음 상태도 함께 저장합니다.

```text
responses             종료 전 임시 답안과 안정적인 attemptId
markedQuestionIds     다시 볼 문제
questionTimers        문제별 누적 풀이시간
pendingSelectionId    제출 전 선택 후보
examEndsAt            모의고사의 절대 종료 시각
```

진단·모의고사는 정답을 중간에 공개하지 않고 `responses`만 갱신합니다. 최종
제출 때 25개 응시 이벤트, 최종 숙달 상태, 완료 세션, `revision`을 하나의
IndexedDB 트랜잭션으로 기록합니다. 실패하면 전체 묶음을 복구 저널의
`attempt-batch` 한 항목으로 보존하므로 일부 문항만 통계에 반영되지 않습니다.

## 모드별 채점·시계 정책

| 모드 | 문제 정보 | 제출 | 피드백 | 시계 |
| --- | --- | --- | --- | --- |
| 유형 학습 | 공개 | 선택 후 확정 | 즉시 | 문제별 소프트 타이머 |
| 오늘의 훈련 | 숨김 | 선택 후 확정 | 즉시 | 문제별 소프트 타이머 |
| 진단 테스트 | 숨김 | 답안 저장 | 종료 후 | 문제별 경과시간 |
| 실전 모의고사 | 숨김 | 답안 저장 | 종료 후 | 절대 종료시각 |
| 속도 훈련 | 숨김 | 한 번 탭 | 없음 | 문제별 소프트 타이머 |
| 복습 큐 | 숨김 | 선택 후 확정 | 즉시 | 문제별 소프트 타이머 |

학습·일일·진단 등 문제별 시계는 현재 페이지에서 `performance.now()`로
측정하며 앱이 숨겨지면 멈춥니다. 실전 모의고사는 `examEndsAt`을
`Date.now()`와 비교하므로 앱을 닫아도 시간이 흐릅니다. 복원 시 종료시각이
지났다면 남은 답을 건너뜀으로 기록하고 자동 제출합니다.

## 일일 목표와 연속일

- 기본 목표는 서로 다른 유효 문제 10개입니다.
- 같은 문제의 즉시 재도전은 목표에 다시 포함하지 않습니다.
- v1의 `solvedByDate`는 연습일 확인에만 사용합니다.
- v1 횟수만으로 서로 다른 문제 완주 여부를 알 수 없으므로 과거 목표 완주일은 만들지 않습니다.
- 목표 완주 연속일은 v2 응시 이벤트가 쌓인 날짜부터 계산합니다.
- 기존 `streak`은 `legacyStreak`으로 백업하지만 공식 연속일에는 합산하지 않습니다.

## 상세 분석 파생 규칙

상세 분석은 별도 사실 원본을 만들지 않고 `attempts`와 현재 문제은행 메타데이터에서
매번 계산합니다.

- 첫 통과 정확도·시간 내 정확도·중앙 풀이시간·시간초과율은 `firstPass` 응시로 계산
- 인지 영역·유형·난이도 성과는 `eligibleForAbilityStats` 응시만 사용
- 유형 성과는 최근 10회와 전체 표본 수를 함께 표시
- 전체 표본 두 번 미만인 유형은 약점으로 분류하지 않음
- 활성 문제은행에서는 T23 스트룹만 `supplemental`로 분리하고 핵심 추론 정확도에서 제외
- 폐기된 T19 일반지식의 과거 응시 스냅샷은 보존하지만 현재 유형·영역 통계에는 다시 편입하지 않음
- 오답 원인 분포는 첫 제출 오답의 `inferredErrorTag`만 집계

과거 응시에 인지 영역이나 난이도 스냅샷이 없으면 같은 `questionId`의 현재
문제은행 값을 사용합니다. 분석 결과는 localStorage나 IndexedDB에 중복
저장하지 않습니다.

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
