import assert from "node:assert/strict";

export async function checkAiReader({ client, baseUrl, fixture, evaluate, navigate, waitForCondition, captureOptionalScreenshot }) {
  console.log("[smoke] AI Trend 뒤로가기·별 위치·모든 저장·스와이프·이전 호 연결·중복 횟수");
  await evaluate(client, "new Promise((resolve,reject)=>{ const r=indexedDB.deleteDatabase('personal-tap-ai-trend'); r.onsuccess=()=>resolve(true); r.onerror=()=>reject(r.error); })");
  const setup = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const NativeDate = Date;
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ["2026-10-21T12:00:00Z"])); } static now() { return NativeDate.parse("2026-10-21T12:00:00Z"); } };
    const base = ${JSON.stringify(fixture)};
    const entries = [
      { id: "2026-10-22-07", scheduledAt: "2026-10-21T22:00:00.000Z", preparedAt: "2026-10-21T11:00:00.000Z", path: "editions/2026-10-22-07-aaaaaaaaaaaaaaaa.json" },
      { id: "2026-10-21-19", scheduledAt: "2026-10-21T10:00:00.000Z", preparedAt: "2026-10-21T09:00:00.000Z", path: "editions/2026-10-21-19-bbbbbbbbbbbbbbbb.json" },
      { id: "2026-10-21-07", scheduledAt: "2026-10-20T22:00:00.000Z", preparedAt: "2026-10-20T21:00:00.000Z", path: "editions/2026-10-21-07-cccccccccccccccc.json" },
      { id: "2026-10-20-19", scheduledAt: "2026-10-20T10:00:00.000Z", preparedAt: "2026-10-20T09:00:00.000Z", path: "editions/2026-10-20-19-dddddddddddddddd.json" }
    ];
    const editions = {};
    for (const entry of entries) editions[entry.path] = { ...structuredClone(base), date: entry.id.slice(0, 10), publication: entry };
    editions[entries[2].path].cards[1] = { ...editions[entries[2].path].cards[1], id: "eeeeeeeeeeeeeeee", title: "Archived-only project", url: "https://example.com/archived-only" };
    if (!sessionStorage.getItem("ai-reader-test-started")) {
      localStorage.removeItem("personal-tap-ai-trend-library-v2");
      localStorage.setItem("personal-tap-ai-trend-saved-v1", JSON.stringify(["eeeeeeeeeeeeeeee"]));
      sessionStorage.setItem("ai-reader-test-started", "1");
    }
    globalThis.readerFixture = { blockOlder: true, calls: 0, entries, editions };
    readerFixture.bookmarkWrites = 0;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (['personal-tap-ai-trend-saved-v1','personal-tap-ai-trend-library-v2'].includes(key)) readerFixture.bookmarkWrites++;
      return originalSetItem.call(this, key, value);
    };
    const nativeFetch = fetch;
    globalThis.fetch = async (...args) => {
      const url = new URL(args[0], location.href);
      if (!url.pathname.includes("/apps/ai-trend/data/")) return nativeFetch(...args);
      readerFixture.calls++;
      if (sessionStorage.getItem("ai-reader-test-offline")) throw new TypeError("offline");
      const key = url.pathname.split("/data/")[1];
      if (readerFixture.blockOlder && /2026-10-(20-19|21-07)/.test(key)) throw new TypeError("archive unavailable");
      return Response.json(key === "release-manifest.json" ? { schemaVersion: 1, releases: entries } : editions[key]);
    };
  })();` });
  try {
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await navigate(client, `${baseUrl}/apps/ai-trend/?scheduled-preview&reader-flow`);
    await waitForCondition(client, "document.body.dataset.ready === 'true' && readerFixture.calls >= 4");
    assert.equal(await evaluate(client, "[...document.querySelector('#editionSelect').options].some(o => o.value === '2026-10-22-07')"), false);
    const originalY = await evaluate(client, `(() => { window.testCard = document.querySelectorAll('.trend-card')[2]; testCard.scrollIntoView({block:'start'}); return scrollY; })()`);
    assert.ok(originalY > 500);
    await evaluate(client, "testCard.querySelector('.save-button').focus({preventScroll:true}); testCard.querySelector('.save-button').click(); true");
    assert.equal(await evaluate(client, "scrollY"), originalY);
    assert.equal(await evaluate(client, "testCard === document.querySelectorAll('.trend-card')[2]"), true);
    assert.equal(await evaluate(client, "document.activeElement === testCard.querySelector('.save-button')"), true);
    await evaluate(client, "testCard.querySelector('.read-button').click(); document.querySelector('#nextSlide').click(); document.querySelector('.slide-panel:not([inert])').scrollTop=70; true");
    const panelY = await evaluate(client, "document.querySelector('.slide-panel:not([inert])').scrollTop");
    await evaluate(client, "document.querySelector('#readerSave').click(); true");
    assert.equal(await evaluate(client, "document.querySelector('#slidePosition').textContent"), "2 / 5");
    assert.equal(await evaluate(client, "document.querySelector('.slide-panel:not([inert])').scrollTop"), panelY);
    await evaluate(client, "history.back(); true");
    await waitForCondition(client, "!document.querySelector('#reader').open");
    assert.equal(await evaluate(client, "location.pathname.endsWith('/apps/ai-trend/')"), true);
    assert.equal(await evaluate(client, "scrollY"), originalY);
    await evaluate(client, "history.forward(); true");
    await waitForCondition(client, "document.querySelector('#reader').open");
    assert.equal(await evaluate(client, "document.querySelector('#slidePosition').textContent"), "2 / 5");
    const rect = await evaluate(client, "(() => {const r=document.querySelector('#slideContent').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
    const x = rect.x + rect.width * .8, y = rect.y + 100;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const delta of [30, 70, 120, 180]) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - delta, y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await waitForCondition(client, "document.querySelector('#slidePosition').textContent === '3 / 5'");
    assert.notEqual(await evaluate(client, "getComputedStyle(document.querySelector('#slideTrack')).transitionDuration"), "0s");
    await captureOptionalScreenshot(client, "ai-reader-mobile");
    await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert.equal(await evaluate(client, "getComputedStyle(document.querySelector('#slideTrack')).transitionDuration"), "0s");
    await client.send("Emulation.setEmulatedMedia", { features: [] });
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitForCondition(client, "!document.querySelector('#reader').open && !history.state?.aiReader");
    assert.equal(await evaluate(client, "scrollY"), originalY);
    await evaluate(client, "document.querySelector('#archiveControl').scrollIntoView(); true");
    await waitForCondition(client, "document.querySelector('#archiveStatus').textContent.includes('받지 못했습니다')");
    assert.equal(await evaluate(client, "document.querySelectorAll('.edition-divider').length"), 0);
    await evaluate(client, "readerFixture.blockOlder=false; document.querySelector('#loadOlder').click(); true");
    await waitForCondition(client, "document.querySelectorAll('.edition-divider').length >= 1");
    assert.equal(await evaluate(client, "testCard === document.querySelectorAll('.trend-card')[2]"), true);
    // The old ID-only favorite is now a durable full-card snapshot.
    await waitForCondition(client, "document.body.dataset.saving !== 'true'");
    assert.equal(await evaluate(client, "(async()=>{ const {openBookmarks}=await import('./js/bookmarks.js?v=20261025.2'); const store=await openBookmarks(); const rows=await store.list(); store.close(); return rows.some(r=>r.card?.id==='eeeeeeeeeeeeeeee'); })()"), true);
    await evaluate(client, "testCard.querySelector('.save-button').click(); true");
    await evaluate(client, "document.querySelector('[data-filter=saved]').click(); true");
    assert.equal(await evaluate(client, "document.querySelectorAll('.trend-card').length"), 2);
    assert.equal(await evaluate(client, "new Set([...document.querySelectorAll('.trend-card')].map(c => c.dataset.editionId)).size"), 2);
    assert.equal(await evaluate(client, "document.querySelector('#archiveControl').hidden"), true);
    await evaluate(client, "document.querySelector('[data-card-id=eeeeeeeeeeeeeeee] .read-button').click(); true");
    for (const width of [320, 390, 1280]) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
      assert.equal(await evaluate(client, "document.documentElement.scrollWidth <= innerWidth && document.querySelector('#reader').scrollWidth <= document.querySelector('#reader').clientWidth"), true);
      await captureOptionalScreenshot(client, `ai-reader-${width}`);
    }
    await evaluate(client, "document.querySelector('#closeReader').click(); true");
    await waitForCondition(client, "!history.state?.aiReader");
    await evaluate(client, "document.querySelector('[data-filter=all]').click(); document.querySelector('#refreshBtn').click(); true");
    await waitForCondition(client, "!document.querySelector('#refreshBtn').disabled && [...document.querySelectorAll('.repeat-badge')].some(b => b.textContent.includes('3번째 선정') && !b.textContent.includes('확인된'))");
    await evaluate(client, "document.querySelector('#archiveControl').scrollIntoView(); true");
    await waitForCondition(client, "document.querySelectorAll('.edition-divider').length === 2");
    assert.equal(await evaluate(client, "document.querySelector('#loadOlder').hidden"), true);
    // Offline reload and a missing archive must still leave saved cards readable.
    await evaluate(client, "sessionStorage.setItem('ai-reader-test-offline','1'); true");
    await navigate(client, `${baseUrl}/apps/ai-trend/?scheduled-preview&saved-offline`);
    await waitForCondition(client, "document.body.dataset.ready === 'true'");
    await evaluate(client, "document.querySelector('[data-filter=saved]').click(); document.querySelector('[data-card-id=eeeeeeeeeeeeeeee] .read-button').click(); true");
    assert.equal(await evaluate(client, "document.querySelectorAll('.trend-card').length"), 2);
    assert.equal(await evaluate(client, "document.querySelector('#reader').open"), true);
    assert.equal(await evaluate(client, "document.querySelector('#readerProject').textContent"), "Archived-only project");
    await evaluate(client, "document.querySelector('#closeReader').click(); true");
    await waitForCondition(client, "!history.state?.aiReader");
    await evaluate(client, "[...document.querySelectorAll('.save-button')].forEach(b => b.click()); true");
    assert.equal(await evaluate(client, "document.querySelectorAll('.trend-card').length"), 0);
    await waitForCondition(client, "document.body.dataset.saving !== 'true'");
    assert.deepEqual(await evaluate(client, "(async()=>{ const {openBookmarks}=await import('./js/bookmarks.js?v=20261025.2'); const store=await openBookmarks(); const rows=await store.list(); store.close(); return rows; })()"), []);
    assert.equal(await evaluate(client, "readerFixture.bookmarkWrites"), 0);
    await evaluate(client, "window.realBookmarkPut=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args){ if(this.transaction.db.name==='personal-tap-ai-trend') throw new DOMException('quota','QuotaExceededError'); return realBookmarkPut.apply(this,args); }; document.querySelector('[data-filter=all]').click(); document.querySelector('.save-button').click(); true");
    await waitForCondition(client, "document.body.dataset.saving !== 'true' && document.querySelector('#status').textContent.includes('기기에 저장하지 못했습니다')");
    await evaluate(client, "document.querySelector('[data-filter=saved]').click(); true");
    assert.equal(await evaluate(client, "document.querySelector('#retrySaved').hidden"), false);
    await evaluate(client, "IDBObjectStore.prototype.put=realBookmarkPut; document.querySelector('#retrySaved').click(); true");
    await waitForCondition(client, "document.querySelector('#retrySaved').hidden && document.body.dataset.saving !== 'true'");
    assert.equal(await evaluate(client, "(async()=>{ const {openBookmarks}=await import('./js/bookmarks.js?v=20261025.2'); const store=await openBookmarks(); const rows=await store.list(); store.close(); return rows.length; })()"), 1);
    // An automatic snapshot recovery failure must not override a later deletion.
    const recoveryId = fixture.cards[2].id;
    await evaluate(client, `(async()=>{ const {openBookmarks}=await import('./js/bookmarks.js?v=20261025.2'); const store=await openBookmarks(); await store.put({id:${JSON.stringify(recoveryId)},savedAt:new Date().toISOString()}); store.close(); return true; })()`);
    const failRecovery = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.recoveryPut=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args){ if(this.transaction.db.name==='personal-tap-ai-trend' && args[0]?.id===${JSON.stringify(recoveryId)} && args[0]?.card) throw new DOMException('quota','QuotaExceededError'); return recoveryPut.apply(this,args); };` });
    try {
      await navigate(client, `${baseUrl}/apps/ai-trend/?scheduled-preview&recovery-failed`);
      await waitForCondition(client, "document.body.dataset.ready === 'true' && document.body.dataset.saving !== 'true' && document.querySelector('#status').textContent.includes('기기에 저장하지 못했습니다')");
      await evaluate(client, `(async()=>{ const {openBookmarks}=await import('./js/bookmarks.js?v=20261025.2'); const store=await openBookmarks(); await store.remove(${JSON.stringify(recoveryId)}); store.close(); IDBObjectStore.prototype.put=recoveryPut; document.querySelector('[data-filter=saved]').click(); document.querySelector('#retrySaved').click(); return true; })()`);
      await waitForCondition(client, "document.querySelector('#retrySaved').hidden && document.body.dataset.saving !== 'true'");
      assert.equal(await evaluate(client, `(async()=>{ const {openBookmarks}=await import('./js/bookmarks.js?v=20261025.2'); const store=await openBookmarks(); const rows=await store.list(); store.close(); return rows.some(r=>r.id===${JSON.stringify(recoveryId)}); })()`), false);
    } finally {
      await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: failRecovery.identifier });
    }
  } finally {
    await evaluate(client, "sessionStorage.removeItem('ai-reader-test-started'); sessionStorage.removeItem('ai-reader-test-offline'); true");
    await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: setup.identifier });
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await client.send("Emulation.clearDeviceMetricsOverride");
  }
}
