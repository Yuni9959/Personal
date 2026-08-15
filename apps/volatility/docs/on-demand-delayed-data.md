# Volatility 요청형 지연 시세 설계·작업 기록

## 결론

Volatility의 네트워크 시세는 **실시간 피드가 아니다**. 페이지에 처음
들어오거나 사용자가 **오늘 시세 새로고침** 버튼을 누를 때만 Jina Reader를 거쳐
Yahoo Finance의 구조화된 chart 응답을 한 번 요청하는 best-effort 참고
기능이다. 예약 작업, 백그라운드 폴링, focus·pageshow 네트워크 갱신, 화면을
열어 둔 동안의 자동 갱신은 사용하지 않는다.

페이지 시작 시에는 네트워크보다 먼저 이 기기의 캐시를 다시 검증한다. MNQ
출처·구조·원천시각 검증을 통과한 활성 세션 캐시와 엄격한 완료 세션 조건을
만족한 캐시만 화면에 복원한다. 두 경우 모두 새 공급자 응답이 성공할 때까지
강제로 `referenceOnly` 처리하므로 현재 시세나 거래 계산 입력이 아니다.

Yahoo는 CME 데이터를 약 10분 지연으로 안내한다. 따라서 1분마다 다시
요청하더라도 실시간이 되지 않으며, 호출 제한과 오류만 늘어난다. 이 구현은
호출 빈도를 줄이는 실용적 절충안이지 Jina·Yahoo·CME의 공식 시세 API,
데이터 사용권 또는 거래용 정확성을 보장하는 방식이 아니다. Jina Reader는
Yahoo URL을 대신 읽어 전달하는 중계 경로일 뿐, 원시 시장데이터의 공급자나
권리자가 아니다.

## 사용자 흐름

1. Volatility 페이지에 접속하면 이 기기에 저장된 공급자 스냅샷을 현재 시각,
   MNQ provenance, 세션 경계와 weekly 기준으로 다시 검증한다. 구조 검증을
   통과한 활성 세션 캐시 또는 최근 완료 세션 캐시만 네트워크 응답 전 먼저
   표시한다. 캐시값은 신규도가 25분 이내여도 읽기 전용이며 자동 계산을 열지
   않는다.
2. 이어 브라우저가 Jina Reader를 통해 Yahoo `MNQ=F`의 최근 5일치 5분봉
   지연 시세를 한 번 요청한다. 사용자가 누르는 **오늘 시세 새로고침**도 같은
   단발 경로만 사용한다.
3. 같은 기기에서 짧은 시간 안에 반복 접속하거나 버튼을 연속으로 누르면
   로컬 cooldown이 추가 요청을 막는다.
4. Jina 외부 envelope의 `code`·`status`·원본 URL·본문을 검증하고, URL의
   host·path·query가 요청한 Yahoo chart URL과 정확히 같을 때만 내부 Yahoo
   JSON을 파싱한다. 이어 상품 유형·CME 거래소·USD·정확한 `5m` 주기,
   종목·시각·OHLC 구조를 검증한다. Yahoo 지연 메타가 있으면 정확히 10분만
   허용하며, 없으면 검증되지 않았다는 상태를 보존한다.
5. `MNQ=F` 데이터가 없거나 429·HTML·네트워크·timeout 오류가 나면
   다른 종목을 추가 조회하지 않고 자동 계산을 잠근다. 계산에 사용할 수 없는
   NQ 대체값을 받기 위한 두 번째 요청은 보내지 않는다.
6. 현재 세션의 완료된 중간 5분봉이 정확히 1개 완전-null이지만 Yahoo meta와
   가격 무결성 교차검증을 통과하면 범위와 안전측 계산은 유지하고 5분 ATR만
   잠근다. 첫·마지막·부분-null, 실제 timestamp gap, 둘 이상 null 또는 가격
   교차검증 실패는 전체 자동 계산을 잠근다.
7. 캐시 또는 새 응답이 승인된 MNQ이고, 현재가 세션 종료 뒤이며, 마지막
   관측값이 종료 전 5분 이내이고, 원천시각이 96시간 이내이며, 원천일과 현재가
   같은 weekly 기준 기간이면 **최근 완료 세션 참고값**으로 표시한다. 이때
   `referenceOnly=true`, `calculationAllowed=false`로 두어 가격표 복기 외 ATR·
   포지션·손절·실전 계산을 모두 금지한다. 종료 시각만 지났지만 마지막 5분
   구간이 없거나 weekly 기간이 다르면 표시하지 않는다. 공개 배포물에는 실제
   Yahoo 시세 파일을 넣지 않는다.
8. 잠긴 값은 수동 폼에 복사하지 않는다. 수동 패널도 기본적으로 닫아 둔다.
   사용자가 영웅문 모바일에서 방금
   확인한 실제 MNQ 월물의 시가·고가·저가·현재가를 모두 다시 입력하고 확인란을
   체크해야 한다. 수동값도 25분 뒤 만료된다.

## 데이터 흐름

```text
페이지 진입 또는 버튼 클릭
        ↓  한 번만 요청
Jina Reader (`r.jina.ai`, 인증정보 없음)
        ↓  `https://query2.finance.yahoo.com/v8/finance/chart/MNQ=F` 전달
        ↓  Yahoo chart JSON (`MNQ=F` 최근 5일·5분봉을 한 번만 확인)
        ↓  15초 timeout · 외부/내부 각 512 KiB · URL/provenance 검증
CME 세션 재구성 (America/Chicago 17:00~익일 16:00)
        ↓  5분 bucket · null · OHLC · tick · 원천시각 검증
지연 참고 스냅샷
        ├─ 진행 세션·≤25분·완전: 범위·안전측·완료봉 ATR
        ├─ 진행 세션·≤25분·1봉 결손 + 가격 메타 일치: 범위·안전측, ATR만 잠금
        ├─ 완료 세션 + 종료 마지막 5분 + ≤96h + 동일 weekly 기간: 참고 가격표만
        └─ 그 밖의 실패: 전체 자동 계산 fail-closed·수동 입력
```

GitHub Actions는 이제 `main` push와 수동 실행 때 테스트를 통과한 정적 PWA만
배포한다. 30분 예약 실행과 배포 중 시장데이터 갱신 단계는 제거했다. 실제
Yahoo 시세를 담았던 `data/market.json`과 정적 갱신 도구도 공개 artifact에서
제거했다.

## 안전 계약

- 화면에는 `실시간`, `LIVE`, `자동 시세`라는 표현을 사용하지 않는다.
- 신규도는 다운로드 시각이 아니라 `market.latestBarAt` 원천 관측시각으로
  계산한다.
- 원천시각이 없거나 미래에 있거나 너무 오래됐으면 fail-closed한다.
- 현재 CME 세션의 완료 5분 bucket이 모두 있으면 범위·안전측과 완료봉 ATR을
  계산한다.
- 중간 완료봉이 정확히 1개 완전-null인 경우에는 Yahoo meta의
  `regularMarketDayHigh`, `regularMarketDayLow`, `regularMarketPrice`,
  `regularMarketTime`과 유효 봉의 H/L/current/time을 정확히 교차검증한다.
  day open meta가 있으면 세션 시가도 일치해야 하고, 없으면 첫 유효 세션봉
  시가를 쓰되 open 교차검증 불가 상태를 기록한다. 검사를 통과할 때만 가격
  기반 계산을 허용하며, 불완전한 시계열로 왜곡될 수 있는 ATR은 잠근다.
- 첫 봉·마지막 봉·부분-null, 실제 timestamp gap, 둘 이상의 완전-null 또는
  1봉 결손 상태의 가격 교차검증 실패는 고가·저가를 축소 추정하지 않고 전체
  자동 계산을 fail-closed한다.
- 동일 bucket의 정렬봉과 synthetic 진행봉은 시가를 보존하고 고가의 최댓값,
  저가의 최솟값만 합쳐 범위를 축소하지 않는다.
- `open`, `high`, `low`, `current`가 양수이고
  `low ≤ open,current ≤ high`이며 0.25 point tick에 맞을 때만 사용한다.
- 네트워크는 `r.jina.ai`에 canonical Yahoo URL을 붙인 GET 한 번뿐이다.
  `Accept: application/json` 외 비단순 헤더, 쿠키·자격증명·referrer를 보내지
  않고 브라우저 HTTP 캐시를 사용하지 않는다.
- Jina 외부 envelope는 `code===200`, `status===200`, `data.url`,
  `data.content`를 요구한다. 반환 URL의 host·path와 `interval=5m`, 정확한
  5일 차이의 `period1`·`period2`, `includePrePost=true`, `events=div,splits` query가
  요청과 canonical하게 일치해야 내부 Yahoo JSON을 파싱한다.
- HTTP 오류, HTML 응답, 스키마 변경, 429, timeout은 모두 정상적인
  공급원 실패로 취급하며 응답 본문을 화면이나 로그에 노출하지 않는다.
- 429의 유효한 `Retry-After`는 안전한 대기정보로 정규화하고, 없거나 무효하면
  기본 60초를 적용한다. 자동 재시도하지 않는다. Jina 외부 JSON과 그 안의
  Yahoo 내부 JSON은 각각 512 KiB 상한을 검사하며, 초과하면 즉시 읽기를
  취소한다. 전체 요청 deadline은 15초다.
- Yahoo `exchangeDataDelayedBy`가 있으면 숫자 10만 허용한다. 필드가 없으면
  10분이라고 추정해 채우지 않고 `delayMetadataVerified=false`로 기록한다.
- 공개 PWA에 API 키, Yahoo 쿠키, 우회 프록시 또는 브라우저 자동화 코드를
  넣지 않는다.
- 연속선물과 실제 월물, MNQ와 NQ를 서로 같은 것으로 표시하지 않는다.
- 이전 캐시를 성공한 새 조회처럼 표시하지 않는다. 시작 시 다시 검증한 뒤
  승인된 MNQ·완료 세션·종료 전 마지막 5분·원천시각 96시간 이내·동일 weekly
  기간을 모두 만족할 때만 `referenceOnly` 참고값으로 표시한다. 이 상태는
  `calculationAllowed=false`이며 ATR·포지션·손절·실전 계산에 소비하지 않는다.
- 탭 간 Web Locks와 일반 10초 cooldown으로 중복 요청을 막고, 시가가 없는
  새 화면·새로고침·시스템 시계 rollback도 이 짧은 제한을 우회하지 못한다.
  공급자 429 대기(최소 60초·최대 15분)는 별도로 더 길게 유지한다.
- Web Locks를 쓸 수 없는 브라우저는 검증 가능한 로컬 storage lease를
  사용한다. Web Locks가 있더라도 cooldown·429 대기를 새 navigation 뒤에
  보존할 로컬 저장소의 쓰기·읽기·삭제 검증을 통과해야 한다. 저장소를 쓸 수
  없으면 요청을 보내지 않는 쪽으로 fail-closed하고 수동 입력을 안내한다.
- 화면을 열어 둔 중에도 로컬 만료 타이머·focus·pageshow에서 기존 값의
  신규도만 다시 검사하며, 이 이벤트로 네트워크를 요청하지 않는다. 원천
  관측시각이 25분을 넘으면 현재 거래 계산은 잠근다. 단, 위 완료 세션 조건과
  96시간·동일 weekly 기간을 모두 만족하면 가격표를 참고용으로만 유지한다.
  주간 기준이 만료되거나 새 기준으로 이전 주 값을 다시 계산해야 하면 그
  참고 가격표도 잠근다.
- 포지션의 손절 ATR은 방향·진입가·진입시각과 출처시각을 묶어 한 번 고정하며,
  새 시세 때문에 조용히 이동시키지 않는다.
- Service Worker는 향후 `/api/*` 응답도 캐시하지 않는다.
- 화면 문구는 **OOS=가격선 도달률≠매매 성공률 · 조건부=마감 후 복기**로
  해석 범위를 한 줄에 고정한다.

## 알려진 한계

- Yahoo 공식 안내상 CME 데이터는 약 10분 지연이고 정보용이다.
- `MNQ=F`는 실제 만기 월물이 아닌 연속 프록시다. 롤오버 때 실제 월물과
  시가·고가·저가가 달라질 수 있다.
- Jina Reader가 브라우저와 Yahoo 사이의 전달 경로를 제공해도 Jina 또는
  Yahoo의 429, timeout, 네트워크 정책, 출력 포맷 변경으로 언제든 실패할 수
  있다. 중계가 원자료의 완전성·정확성·최신성을 높여 주는 것은 아니다.
- Web Locks와 로컬 저장소를 모두 차단한 강한 프라이버시 환경에서는 중복
  요청을 안전하게 조정할 수 없어 자동 조회와 버튼 조회를 모두 중지한다.
- Jina 공식 문서는 API 키 없는 기본 사용을 안내하지만 무료 한도·지연시간·
  가용성이 영구적으로 보장된다는 뜻은 아니다. Jina를 사용해도 Yahoo
  데이터의 이용·저장·재배포 권리를 얻는 것은 아니다.
- 요청 횟수가 적어져도 Jina·Yahoo의 약관과 데이터 권리 문제가 사라지는
  것은 아니다. 이 기능은 사용자가 요청한 제한적 best-effort 참고 기능이며,
  공식 사용 허가를 의미하지 않는다.
- 따라서 주문·손절 판단 전 실제 MNQ 월물의 증권사 표시값과 반드시
  대조해야 한다.

## 관련 파일

| 파일 | 역할 |
|---|---|
| `apps/volatility/js/market-provider.js` | Jina Reader 요청·Yahoo 응답 검증·세션 재구성·결손 정책·스냅샷 생성 |
| `apps/volatility/js/request-guard.js` | 일반 10초 경계·공급자 429 대기·시계 rollback·동시 탭 요청 잠금 |
| `apps/volatility/js/snapshot-policy.js` | 25분 현재 시세·96시간 완료 세션·종료 5분·동일 weekly 기간·심볼의 순수 fail-closed 판정 |
| `apps/volatility/js/app.js` | 시작 캐시의 강제 읽기 전용 복원, 진입/버튼 단발 요청, referenceOnly 계산 격리, 탭 잠금·cooldown과 화면 상태 |
| `apps/volatility/js/calculator.js` | 평균·안전측·포지션·손절 계산 계약 |
| `apps/volatility/index.html` | 지연·프록시·수동 대조 안내 UI |
| `.github/workflows/deploy-pages.yml` | 예약 시세 갱신 없는 정적 Pages 배포 |
| `apps/volatility/tests/` | 공급원·계산·UI 회귀 테스트 |

## 근거

- [Jina Reader 공식 문서](https://jina.ai/reader/): 대상 URL 앞에
  `r.jina.ai`를 붙이는 기본 사용법, API 키 없는 기본 사용과 호출 한도를
  안내한다.
- [Yahoo Finance 거래소별 지연 안내](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html):
  CME 10분 지연, 정보용이며 거래용이 아님을 안내한다.
- [Yahoo 이용약관](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html):
  사전 허가 없는 자동 수집 제한을 명시한다.

## 향후 교체 지점

정식 사용권과 실제 MNQ 월물을 제공하는 API를 확보하면 UI와 계산 로직은
그대로 두고 `market-provider.js` 어댑터만 교체한다. 새 공급원은 최소한
`provider`, `exchange`, 실제 월물 코드·만기, 거래소 원천시각, 지연 권한,
OHLC, 0.25 tick 정합성과 오류 상태를 제공해야 한다.

## 안전측 수치 해석

- 장중 종가 방향을 모르는 ex-ante q25 기본선은 상승 `+0.359538123%`,
  하락 `-0.295051201%`이며 최종 미사용 52주의 **가격선 도달률**은 각각
  72.73%(184/253), 73.52%(186/253)다.
- 종가가 양봉·음봉이었다고 사후에 나눈 조건부 q25 복기선은
  `+0.707993802%`, `-0.815282551%`이며 매주 재적합한 정책의 조건부
  도달률은 79.56%(109/137), 79.31%(92/116)다.
- 조건부 수치는 종가 방향을 미리 아는 진입 신호가 아니며, 위 네 비율은 모두
  체결 방향·진입시각·손절·비용·고가와 저가의 도달 순서를 반영한 거래
  성공률이 아니다.
