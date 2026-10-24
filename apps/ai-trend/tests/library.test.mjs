import assert from "node:assert/strict";
import test from "node:test";
import { identityCard, normalizedUrl, occurrenceFor, sameProject } from "../js/library.js";
const project = (title, url, extra = {}) => ({ id: "aaaaaaaaaaaaaaaa", title, url, category: "project", ...extra });

test("프로젝트 URL의 추적 정보·README·.git·대소문자를 동일 저장소로 인식한다", () => {
  const a = project("NVIDIA/OpenShell", "https://github.com/NVIDIA/OpenShell?utm_source=test#readme");
  const b = project("OpenShell", "https://www.github.com/nvidia/openshell.git/blob/main/README.md");
  assert.equal(sameProject(a, b), true);
  assert.equal(normalizedUrl("javascript:alert(1)", "project"), null);
  assert.equal(normalizedUrl("https://user:pass@example.com", "project"), null);
});
test("프로젝트 이름과 공식 근거를 함께 사용하고 다른 제작자의 동명 저장소를 합치지 않는다", () => {
  const a = project("NVIDIA/OpenShell", "https://github.com/nvidia/openshell");
  assert.equal(sameProject(a, project("NVIDIA / OpenShell", "https://openshell.example/product")), true);
  assert.equal(sameProject(a, project("OpenShell", "https://github.com/other/openshell")), false);
  assert.equal(sameProject(project("Tool", "https://gitlab.com/a/tool"), project("Tool", "https://gitlab.com/b/tool")), false);
  assert.equal(sameProject(a, project("OpenShell", "https://unrelated.example")), false);
  assert.equal(sameProject(a, project("OpenShell", "https://openshell.example", { evidence: [{ url: a.url, kind: "official" }] })), true);
  assert.equal(sameProject(a, project("OpenShell", "https://unrelated.example", { evidence: [{ url: a.url, kind: "community" }] })), false);
});
test("같은 회사의 다른 뉴스·다른 모델은 동일 프로젝트로 뭉치지 않는다", () => {
  const a = { ...project("새로운 발표", "https://example.com/blog/one"), category: "news" };
  assert.equal(sameProject(a, { ...a, url: "https://example.com/blog/two" }), false);
  assert.equal(sameProject(a, { ...a, url: `${a.url}?utm_campaign=news` }), true);
  assert.equal(sameProject({ ...a, category: "model" }, { ...a, category: "model", url: "https://example.com/model/two" }), false);
});
test("선정 횟수는 호별 1회로 세고 재발행·미래 호를 현재 호의 중복 횟수에 넣지 않는다", () => {
  const card = project("owner/tool", "https://github.com/owner/tool");
  const catalog = [
    { id: "2026-10-23-07", cards: [card, card] },
    { id: "2026-10-23-19", cards: [{ ...card, id: "bbbbbbbbbbbbbbbb", url: `${card.url}/?utm_source=a` }] },
    { id: "2026-10-23-19", cards: [card] },
    { id: "2026-10-24-07", cards: [card] },
    { id: "2026-10-24-19", cards: [card] }
  ];
  assert.deepEqual(occurrenceFor(card, "2026-10-24-07", catalog), { count: 3, repeats: 2, first: "2026-10-23-07" });
  assert.equal(occurrenceFor(card, "2026-10-23-07", catalog).count, 1);
});
test("공개 색인은 본문·후보·커뮤니티 원문을 담지 않고 식별 정보만 남긴다", () => {
  const compact = identityCard({ ...project("tool", "https://example.com"), slides: [{ body: "private" }], evidence: [{ kind: "official", url: "https://example.com" }, { kind: "community", url: "https://forum.example" }] });
  assert.equal(compact.slides, undefined);
  assert.equal(compact.evidence.length, 1);
});
