# Personal Tap 작업 지침

## AI Trend·시세 API 운영

- AI Trend 공개 시각은 매일 07:00·19:00 KST다. `daily-briefing.yml`은
  03:17·05:17·15:17·17:17 KST에 미리 수집한다. 준비는 공개가 아니다.
- 사용자가 즉시 신규 발행을 명시한 경우에만 `research.mjs --publish-now`로
  `kind: extra` 추가호 1개를 준비한다. 기존 정시 호를 덮어쓰지 않으며 동일한
  데이터 브랜치 게시·서버 확인 절차를 따른다. 자동 작업에는 이 옵션을 넣지 않는다.
- AI 데이터는 `ai-trend-data` 브랜치의 `apps/ai-trend/data/**`에만 게시한다.
  `tools/ai-trend-store.mjs pull/push/verify`로 동시 변경을 거부하고 서버 확인까지
  완료한다. 데이터 변경으로 main push나 Pages dispatch를 하지 않는다.
- `/api/ai-trend`는 서버 시각으로 공개된 불변 발행본을 선택한다. 미래 파일을
  최신 발행본으로 표시하거나, 수집 실패/오래된 검토를 새 내용으로 바꾸지 않는다.
- AI 발행 manifest의 `catalogPath`는 SHA-256 경로의 정규화 색인을 참조한다.
  `prepareEdition` 또는 `ai-trend-store.mjs index`로 생성하고 본문·색인 일치를 검증한다.
  기존 데이터의 색인 보강으로 공개 발행본을 다시 쓰지 않는다. 기기 즐겨찾기 IndexedDB
  이전은 원본 localStorage와 트랜잭션 완료 표식을 보존하며 해제 항목을 재수입하지 않는다.
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
- 수집 경로와 후보 목록은 `apps/ai-trend/tools/sources.mjs`에 기록한다.
  논문은 research 채널로 구분하고 호당 최대 2개를 선정한다. alphaXiv의 조회·반응은
  연구 품질이나 동료심사 통과의 근거가 아니다. 보도·커뮤니티 원문을 제작자의 공식
  발표로 바꾸지 않으며, 본문 1,000자 이상의 근거와 한국어 5장 검증을 유지한다.

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

## 이미지 카드뉴스

- 선택 테마 (2)의 `#FFDA7D #CCBA8D #999488 #665E48 #332C1A` 5색만 사용한다.
  1080×1350 indexed PNG의 실제 픽셀·팔레트·SHA-256을 `poster-assets.mjs`로 검증한다.
- 슬라이드의 optional `image`만 추가한다. 기존 한국어 본문·근거 ID·검토 시각을 보존하고
  이미지 실패 시 상세 본문을 자동 표시한다. 원고 재요약을 신규 원문 조사로 표시하지 않는다.
- 이미지 파일은 데이터 브랜치의 `apps/ai-trend/data/images/<sha256>.png`에만 게시한다.
  store pull/push/verify를 사용하고 기존 정시·추가호를 덮어쓰지 않는다.
- 이미지 특별호의 원고 묶음 생성·렌더링은 수동 실행 가능한 별도 작업이다.
  자동 정시 생성으로 확대하거나 예약 시간을 바꾸려면 해당 범위를 명시해 구현·검증한다.
