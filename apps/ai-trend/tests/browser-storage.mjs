import assert from "node:assert/strict";

export async function checkAiStorage({ client, fixture, evaluate }) {
  console.log("[smoke] AI Trend IndexedDB 이전 원자성·재시도·동시 저장·삭제 복원 방지");
  const result = await evaluate(client, `(async () => {
    const { openBookmarks } = await import('./js/bookmarks.js?v=20261026.4');
    const fixture = ${JSON.stringify(fixture)};
    const name = 'personal-tap-ai-db-test-' + crypto.randomUUID();
    const record = card => ({id:card.id, card, edition:{schemaVersion:fixture.schemaVersion,date:fixture.date,generatedAt:fixture.generatedAt}, savedAt:new Date().toISOString()});
    const originals = [record(fixture.cards[0]), record(fixture.cards[1])];
    const unknown = 'ffffffffffffffff';
    const old = new Map([['personal-tap-ai-trend-saved-v1',JSON.stringify([unknown])],['personal-tap-ai-trend-library-v2',JSON.stringify(originals)]]);
    const storage = {getItem:key=>old.get(key)||null};
    const originalPut=IDBObjectStore.prototype.put;
    let count=0, migrationFailed=false;
    IDBObjectStore.prototype.put=function(...args) {
      const request=originalPut.apply(this,args);
      if(this.transaction.db.name===name && this.name==='bookmarks' && ++count===2) this.transaction.abort();
      return request;
    };
    try {await openBookmarks({name,storage});} catch {migrationFailed=true;} finally {IDBObjectStore.prototype.put=originalPut;}
    const raw=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const rolledBack=await new Promise(resolve=>{const tx=raw.transaction(['bookmarks','meta'],'readonly');let rows,marker;tx.objectStore('bookmarks').getAll().onsuccess=e=>rows=e.target.result;tx.objectStore('meta').get('legacy-import-v1').onsuccess=e=>marker=e.target.result;tx.oncomplete=()=>resolve(!rows.length && !marker);});raw.close();
    const first=await openBookmarks({name,storage});
    const migrated=await first.list();
    const second=await openBookmarks({name,storage:{getItem:()=>{throw new Error('must not reread legacy after commit');}}});
    const a=record(fixture.cards[2]), b=record(fixture.cards[3]);
    await Promise.all([first.put(a),second.put(b)]);
    const together=await first.list();
    await first.remove(unknown);
    const recovery=await second.recover({...a,id:unknown,card:{...a.card,id:unknown}});
    let failedWrite=false;
    IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===name) throw new DOMException('quota','QuotaExceededError');return originalPut.apply(this,args);};
    try {await first.put({...a,card:{...a.card,title:'should not persist'}});} catch {failedWrite=true;} finally {IDBObjectStore.prototype.put=originalPut;}
    const afterFailure=await second.list();
    await first.remove(originals[0].id); first.close(); second.close();
    const reopened=await openBookmarks({name,storage});const afterReload=await reopened.list();reopened.close();
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
    return {migrationFailed,rolledBack,migrated:migrated.length,legacyIntact:old.get('personal-tap-ai-trend-library-v2')===JSON.stringify(originals),concurrent: together.some(r=>r.id===a.id)&&together.some(r=>r.id===b.id),recovery,failedWrite,previousIntact:afterFailure.find(r=>r.id===a.id).card.title===a.card.title,removedStayedRemoved:!afterReload.some(r=>r.id===originals[0].id)};
  })()`);
  assert.deepEqual(result, { migrationFailed: true, rolledBack: true, migrated: 3, legacyIntact: true, concurrent: true, recovery: null, failedWrite: true, previousIntact: true, removedStayedRemoved: true });
}
