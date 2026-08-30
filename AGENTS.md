# Personal Tap 작업 지침

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
