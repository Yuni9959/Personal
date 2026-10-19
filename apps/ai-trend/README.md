# AI Trend

Personal Tap의 매일 AI 탐색 탭. `./apps/ai-trend/`에서 열며 API 키나 PC 상시
실행 없이 GitHub Pages에 게시된 발행본을 읽는다.

- GitHub Trending의 오늘 증가 별과 최근 45일 생성된 `llm` 저장소를 분리한다.
  신규 저장소 정렬은 누적 별 기준이며 첫 수집에 성장량을 만들어내지 않는다.
  이후 수집은 직전 수집 대비 변화량을 명시한다.
- Hugging Face trendingScore 모델, OpenAI·Google AI·Hugging Face 공식 RSS를
  확인한다. 뉴스는 최근 7일이며 미래 항목과 위험 URL을 제외한다.
- 최대 프로젝트 6·뉴스 5·모델 3개. 원문 URL로 중복 제거하고 뉴스는 출처를
  순환한다. 일부 수집 실패는 출처 상태에 표시한다. 3개 미만 또는 분류가
  2개 미만이면 발행을 거부해 직전 파일을 보존한다.
- 제목·설명·모델 README·공식 글의 짧은 원문 발췌를 유지한다. 카드뉴스 1장은
  핵심 원문, 2장은 수집한 관심 지표의 한국어 설명, 3장은 확인할 항목이다.
  LLM 추론·번역 결과가 아니며 별·다운로드를 성능이나 품질 보증으로 쓰지 않는다.
- 검색·분류·관심 항목 저장·3장 독서·방향키·스와이프·원문 링크를 제공한다.
  저장은 기기 localStorage의 ID 목록이고 발행일 선택으로 과거 항목을 볼 수 있다.
  archive는 최신 30일만 유지한다. 기록과 원문을 가져올 때 저장소 코드를 실행하지 않는다.
- PWA는 최신 발행본과 앱 자산을 보관한다. nonce를 제거한 키로 network-first
  처리하므로 오프라인에서도 보관된 날짜를 명시하고 읽을 수 있다. fetch 실패 시
  화면의 발행본/검증된 로컬 보관본을 유지한다. 지난 발행본을 오늘로 바꾸지 않는다.

`npm run collect:ai-trend`로 수동 수집한다. 선택적으로 `GH_TOKEN`을 환경에
전달하면 GitHub API의 인증 호출 한도를 사용한다. 토큰을 데이터나 로그에 남기지
않는다. 실제 최신 데이터는 `data/latest.json`, 날짜 목록은 `data/index.json`,
과거 발행본은 `data/archive/YYYY-MM-DD.json`에 있다.

`daily-briefing.yml`은 매일 23:17 UTC(08:17 KST) 예약과 수동 실행을 지원한다.
AI와 주간 Volatility 수집을 각각 실행하고 전체 검증 후 생성 데이터만 게시한다.
직후 재사용 Pages workflow로 배포한다. 예약 지연이나 전체 수집 실패 시 화면에
직전 발행일을 표시한다. 외부 메시지·이메일·푸시 알림을 보내는 기능은 없다.

검증: `npm run test:ai-trend`, 전체 `npm run test:release`.
