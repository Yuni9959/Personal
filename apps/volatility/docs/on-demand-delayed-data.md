# Volatility 요청형 지연 시세 설계·작업 기록

## 결론

Volatility의 네트워크 시세는 **실시간 피드가 아니다**. 페이지에 처음
들어오거나 사용자가 **새 데이터 확인** 버튼을 누를 때만 Yahoo Finance의
구조화된 chart 응답을 한 번 요청하는 best-effort 참고 기능이다. 예약 작업,
백그라운드 폴링, 화면을 열어 둔 동안의 자동 갱신은 사용하지 않는다.

Yahoo는 CME 데이터를 약 10분 지연으로 안내한다. 따라서 1분마다 다시
요청하더라도 실시간이 되지 않으며, 호출 제한과 오류만 늘어난다. 이 구현은
호출 빈도를 줄이는 실용적 절충안이지 Yahoo·CME의 공식 API, 사용권 또는
거래용 정확성을 보장하는 방식이 아니다.

## 사용자 흐름

1. Volatility 페이지에 접속하면 브라우저가 지연 시세를 한 번 요청한다.
2. 같은 기기에서 짧은 시간 안에 반복 접속하거나 버튼을 연속으로 누르면
   로컬 cooldown이 추가 요청을 막는다.
3. 응답의 상품 유형·CME 거래소·USD·정확한 `5m` 주기·10분 지연 메타,
   종목·시각·OHLC 구조를 검증한 뒤에만 화면에 적용한다.
4. `MNQ=F` 데이터가 없거나 429·HTML·네트워크·timeout 오류가 나면
   다른 종목을 추가 조회하지 않고 자동 계산을 잠근다. 계산에 사용할 수 없는
   NQ 대체값을 받기 위한 두 번째 요청은 보내지 않는다.
5. 조회가 실패하면 이 기기에서 앞서 성공한 로컬 스냅샷만 이전 참고값으로
   표시한다. 공개 배포물에는 실제 Yahoo 시세 파일을 넣지 않는다.
   원천 관측시각이 허용 범위를 넘으면 그 값으로 가격선·포지션 시나리오를
   새로 계산하지 않고 수동 입력을 안내한다.
6. 잠긴 값은 수동 폼에 복사하지 않는다. 사용자가 영웅문 모바일에서 방금
   확인한 실제 MNQ 월물의 시가·고가·저가·현재가를 모두 다시 입력하고 확인란을
   체크해야 한다. 수동값도 25분 뒤 만료된다.

## 데이터 흐름

```text
페이지 진입 또는 버튼 클릭
        ↓  한 번만 요청
Yahoo chart JSON (`MNQ=F` 한 번만 확인)
        ↓  전체 7초 timeout · HTTP · content-type · provenance 검증
CME 세션 재구성 (America/Chicago 17:00~익일 16:00)
        ↓  5분 bucket 연속성 · null · OHLC · tick · 원천시각 검증
지연 참고 스냅샷
        ↓
Volatility 화면 또는 fail-closed 수동 입력
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
- 현재 CME 세션의 첫 봉·중간 5분 bucket·OHLC가 하나라도 누락되면
  고가·저가를 축소 추정하지 않고 fail-closed한다.
- 동일 bucket의 정렬봉과 synthetic 진행봉은 시가를 보존하고 고가의 최댓값,
  저가의 최솟값만 합쳐 범위를 축소하지 않는다.
- `open`, `high`, `low`, `current`가 양수이고
  `low ≤ open,current ≤ high`이며 0.25 point tick에 맞을 때만 사용한다.
- 네트워크 요청은 쿠키·자격증명을 보내지 않고 캐시를 사용하지 않는다.
- HTTP 오류, HTML 응답, 스키마 변경, 429, timeout은 모두 정상적인
  공급원 실패로 취급하며 응답 본문을 화면이나 로그에 노출하지 않는다.
- 429에서는 `Retry-After`만 안전한 대기정보로 정규화하고 자동 재시도하지
  않는다. JSON 본문은 512 KiB 상한을 헤더와 실제 읽은 바이트 양쪽에서
  검사하며, 초과하면 즉시 읽기를 취소한다.
- 공개 PWA에 API 키, Yahoo 쿠키, 우회 프록시 또는 브라우저 자동화 코드를
  넣지 않는다.
- 연속선물과 실제 월물, MNQ와 NQ를 서로 같은 것으로 표시하지 않는다.
- 이전 캐시를 성공한 새 조회처럼 표시하지 않는다.
- 탭 간 Web Locks와 60초 cooldown으로 중복 요청을 막고, 시스템 시계가
  뒤로 바뀌어도 cooldown을 우회하지 않는다.
- Web Locks를 쓸 수 없는 브라우저는 검증 가능한 로컬 storage lease를
  사용한다. Web Locks와 로컬 저장소가 모두 막힌 환경에서는 요청을 보내지
  않는 쪽으로 fail-closed한다.
- 화면을 열어 둔 중에도 로컬 만료 타이머·focus·pageshow에서 신규도를 다시
  검사한다. 25분 또는 주간 기준 만료 뒤에는 파생 계산과 ATR 표시를 잠근다.
- 포지션의 손절 ATR은 방향·진입가·진입시각과 출처시각을 묶어 한 번 고정하며,
  새 시세 때문에 조용히 이동시키지 않는다.
- Service Worker는 향후 `/api/*` 응답도 캐시하지 않는다.

## 알려진 한계

- Yahoo 공식 안내상 CME 데이터는 약 10분 지연이고 정보용이다.
- `MNQ=F`는 실제 만기 월물이 아닌 연속 프록시다. 롤오버 때 실제 월물과
  시가·고가·저가가 달라질 수 있다.
- 브라우저 직접 요청은 CORS, 429 호출 제한, 네트워크 정책 또는 응답 형식
  변경으로 실패할 수 있다. 2026-08-14 개발 점검에서도 429가 재현됐다.
- Web Locks와 로컬 저장소를 모두 차단한 강한 프라이버시 환경에서는 중복
  요청을 안전하게 조정할 수 없어 자동 조회와 버튼 조회를 모두 중지한다.
- yfinance는 Yahoo가 승인한 공식 SDK가 아니며 연구·교육 목적 도구라고
  자체 문서에서 설명한다.
- 요청 횟수가 적어져도 자동 수집에 관한 Yahoo 이용약관 문제가 사라지는
  것은 아니다. 이 기능은 사용자가 선택한 제한적 best-effort 참고 기능이며,
  공식 사용 허가를 의미하지 않는다.
- 따라서 주문·손절 판단 전 실제 MNQ 월물의 증권사 표시값과 반드시
  대조해야 한다.

## 관련 파일

| 파일 | 역할 |
|---|---|
| `apps/volatility/js/market-provider.js` | Yahoo 응답 검증·세션 재구성·스냅샷 생성 |
| `apps/volatility/js/request-guard.js` | 60초 경계·시계 rollback·동시 탭 요청 잠금 |
| `apps/volatility/js/snapshot-policy.js` | 25분 만료·심볼·주간 기준의 순수 fail-closed 판정 |
| `apps/volatility/js/app.js` | 진입/버튼 단발 요청, 탭 잠금·cooldown, 로컬 폴백과 화면 상태 |
| `apps/volatility/js/calculator.js` | 원천 관측시각 기준 신규도와 계산 계약 |
| `apps/volatility/index.html` | 지연·프록시·수동 대조 안내 UI |
| `.github/workflows/deploy-pages.yml` | 예약 시세 갱신 없는 정적 Pages 배포 |
| `apps/volatility/tests/` | 공급원·계산·UI 회귀 테스트 |

## 근거

- [Yahoo Finance 거래소별 지연 안내](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html):
  CME 10분 지연, 정보용이며 거래용이 아님을 안내한다.
- [yfinance 공식 문서](https://ranaroussi.github.io/yfinance/): Yahoo 비제휴
  오픈소스이며 연구·교육 목적이라고 설명한다.
- [Yahoo 이용약관](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html):
  사전 허가 없는 자동 수집 제한을 명시한다.

## 향후 교체 지점

정식 사용권과 실제 MNQ 월물을 제공하는 API를 확보하면 UI와 계산 로직은
그대로 두고 `market-provider.js` 어댑터만 교체한다. 새 공급원은 최소한
`provider`, `exchange`, 실제 월물 코드·만기, 거래소 원천시각, 지연 권한,
OHLC, 0.25 tick 정합성과 오류 상태를 제공해야 한다.
