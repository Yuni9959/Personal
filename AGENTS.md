# Personal Tap 작업 지침

## AI Trend·시세 API 운영

- AI Trend 공개 시각은 매일 07:00·19:00 KST다. `daily-briefing.yml`은
  03:17·05:17·15:17·17:17 KST에 미리 수집한다. 준비는 공개가 아니다.
- AI 데이터는 `ai-trend-data` 브랜치의 `apps/ai-trend/data/**`에만 게시한다.
  `tools/ai-trend-store.mjs pull/push/verify`로 동시 변경을 거부하고 서버 확인까지
  완료한다. 데이터 변경으로 main push나 Pages dispatch를 하지 않는다.
- `/api/ai-trend`는 서버 시각으로 공개된 불변 발행본을 선택한다. 미래 파일을
  최신 발행본으로 표시하거나, 수집 실패/오래된 검토를 새 내용으로 바꾸지 않는다.
- 주간 기준은 별도 job에서 생성하며 실제 모듈 변경이 있을 때만 전체 검사·main push·
  재사용 Pages workflow를 호출한다. GITHUB_TOKEN push의 workflow 실행을 가정하지 않는다.
- 장중 시세는 `api/market.js`의 전용 Vercel API를 우선한다. 비밀키·PC·Drive에
  의존하지 않으며 원시 시세 파일을 Pages에 자동 게시하지 않는다.
- 완전한 세션봉과 다른 일중 요약 H/L을 비교할 때의 범위 차이만 분리한다.
  결손봉·현재가/원천시각·종목·만료 검증을 제거해 성공으로 바꾸지 않는다.
- AI 카드는 schema 2의 근거 연결 한국어 심층 요약 5장이다. 제작자 주장·외부 반응·
  추정 활용을 구분하며 독립 평가 부족을 숨기지 않는다. 분야는 새 이름을 허용한다.
  클라우드 사전 수집과 PC의 05:00·17:00 한글 생성은 별도 단계다. 숨김 실행·10분 간격 3회 재시도를 유지한다. PC 종료·생성 실패 시
  기존 한글을 영어로 대체하지 않고 검토 시각·대기 수를 표시한다. 로컬 인증은 업로드하지 않는다.
- `.env*`, `.vercel/`, 로컬 거래 자료는 Git·Pages·Vercel upload에 넣지 않는다.
- AI 선정은 `selection.mjs`의 관측 속도·신규성·반복/분야 분산 정책을 사용한다.
  첫 관측·짧거나 오래된 구간·롤링 다운로드 차이로 성장량을 만들지 않는다. 후보의 중복
  GitHub 검색은 독립 확인이 아니며 HN의 정확한 동일 링크만 교차 신호로 연결한다.
  내부 candidatePool은 게시하지 않고 요약 실패는 검증된 후순위 후보로 보충한다.

## 입시 Vercel 릴리스 연동 규칙

- 입시 서비스의 검증된 Vercel stable 릴리스는 `tools/publish-university-release.ps1`로만 PT에 반영한다.
- publisher는 `apps.js`, `sw.js`만 수정할 수 있으며, 전체 `npm run test:release` 통과 후 명시적으로 commit하고 `origin/main`에 push한 뒤 공개 GitHub Pages의 release fingerprint까지 확인한다.
- unrelated working tree 변경이나 허용 범위 밖 unpushed commit이 있으면 자동으로 섞지 않고 fail-closed한다.
- Vercel 성공 후 PT 동기화가 실패해도 Vercel을 재배포하거나 rollback하지 않는다. 입시 서비스의 `runtime/release_automation/pt_sync_pending.json`을 기준으로 동일 릴리스의 PT 후처리만 재시도한다.
- 이 연동은 사용자가 상시 승인한 릴리스 완료 조건이다. 자격 증명 또는 Git 충돌처럼 새 판단이 필요한 경우에만 중단해 보고한다.

## 시작 전

- 이 저장소가 `멘사 준비` 폴더의 유일한 활성 개발본이다.
- 작업을 시작할 때 `README.md`, `../../README.md`,
  `git status --short --branch`, 최근 커밋을 확인한다.
- 사용자 변경과 관련 없는 기존 변경을 보존하고, `.tmp/`와 보관용 ZIP을 제품
  소스로 사용하지 않는다.

## 변경 작업 완료 규칙

코드나 문서 변경을 요청받아 완료한 경우, 사용자가 달리 지시하지 않는 한 다음
절차를 같은 작업의 일부로 자동 수행한다.

1. 이 저장소의 `README.md`에서 현재 릴리스 상태, 완료 내용, 다음 작업을
   실제 결과에 맞게 갱신한다.
2. 저장소 밖의 통합 문서 `../../README.md`에도 실제 브랜치·커밋·검증
   상태와 다음 작업을 갱신한다.
3. 관련 테스트를 실행한다. 기본 전체 릴리스 검증은
   `npm run test:release`다.
4. `git diff --check`, `git status`, 실제 diff를 검토한다.
5. 현재 작업에 속한 파일만 명시적으로 스테이징하고 간결한 Conventional
   Commit 형식으로 커밋한다.
6. 커밋한 현재 브랜치를 `origin`에 푸시한다. 프로젝트 소유자의 상시 지시에
   따라 검증을 통과한 완료 작업은 `main` 직접 푸시도 허용된다.
7. 푸시가 실패하면 완료로 간주하지 말고 원인과 로컬 커밋 상태를 보고한다.

단순 조회·설명·진단처럼 파일을 바꾸지 않은 작업에는 커밋과 푸시를 만들지
않는다. 사용자가 해당 작업에서 커밋 또는 푸시를 금지하면 그 지시를 우선한다.
관련 없는 기존 변경, 무시 파일, 생성된 임시 산출물, 비밀정보는 자동
스테이징하지 않는다.

`../../README.md`는 이 Git 저장소 밖에 있으므로 커밋·푸시 대상이 아니다.
원격에 필요한 변경 요약과 작업 규칙은 이 저장소의 `README.md`와 이 파일에도
반드시 남긴다.
