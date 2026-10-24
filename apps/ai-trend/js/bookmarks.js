import { validateEdition } from "./model.js?v=20261025.2";

export const BOOKMARK_DB = "personal-tap-ai-trend";
const IDS = "personal-tap-ai-trend-saved-v1", SNAPSHOTS = "personal-tap-ai-trend-library-v2";
const validId = id => /^[a-f0-9]{16}$/.test(id);
export function validBookmark(record) {
  try {
    if (!validId(record?.id) || !Number.isFinite(Date.parse(record.savedAt))) return false;
    if (!record.card) return record.edition == null;
    if (record.card.id !== record.id) return false;
    validateEdition({ ...record.edition, cards: [record.card] });
    const issue = record.edition.publication;
    return !issue || /^\d{4}-\d{2}-\d{2}-(07|19)$/.test(issue.id);
  } catch { return false; }
}
export function legacyBookmarks(storage) {
  const records = new Map();
  const parse = key => { const value = storage?.getItem(key); if (!value) return []; try { const data = JSON.parse(value); return Array.isArray(data) ? data : []; } catch { return []; } };
  for (const id of parse(IDS)) if (validId(id)) records.set(id, { id, savedAt: new Date().toISOString() });
  for (const value of parse(SNAPSHOTS)) {
    const record = { ...value, id: value?.card?.id, savedAt: value?.savedAt || new Date().toISOString() };
    if (validBookmark(record)) records.set(record.id, record);
  }
  return [...records.values()];
}
function transaction(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error("저장 작업이 취소됐습니다."));
    tx.onerror = () => {}; // abort is the final outcome; request success is not a commit.
    try { work(tx, value => { result = value; }); }
    catch (error) { tx.abort(); reject(error); }
  });
}
export async function openBookmarks({ indexedDB = globalThis.indexedDB, storage = globalThis.localStorage, name = BOOKMARK_DB } = {}) {
  const db = await new Promise((resolve, reject) => {
    if (!indexedDB?.open) { reject(new Error("기기 저장소를 사용할 수 없습니다.")); return; }
    const request = indexedDB.open(name, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("다른 탭의 저장소 전환을 기다리고 있습니다.")); }, 4000);
    request.onupgradeneeded = () => {
      const bookmarks = request.result.createObjectStore("bookmarks", { keyPath: "id" });
      bookmarks.createIndex("savedAt", "savedAt");
      request.result.createObjectStore("meta", { keyPath: "key" });
    };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
  });
  db.onversionchange = () => db.close();
  try {
    const imported = await transaction(db, ["meta"], "readonly", (tx, done) => {
      tx.objectStore("meta").get("legacy-import-v1").onsuccess = event => done(!!event.target.result);
    });
    if (!imported) {
      const legacy = legacyBookmarks(storage);
      await transaction(db, ["bookmarks", "meta"], "readwrite", tx => {
        const meta = tx.objectStore("meta"), store = tx.objectStore("bookmarks");
        meta.get("legacy-import-v1").onsuccess = event => {
          if (event.target.result) return;
          try {
            for (const record of legacy) {
              store.get(record.id).onsuccess = event => {
                try { if (!event.target.result) store.put(record); } catch { tx.abort(); }
              };
            }
            meta.put({ key: "legacy-import-v1", completedAt: new Date().toISOString() });
          } catch { tx.abort(); }
        };
      });
    }
    // Keep old keys as recovery copies. Only the transaction marker controls import,
    // so a removed bookmark cannot return on a later reload.
    return {
      close: () => db.close(),
      async list() {
        return transaction(db, ["bookmarks"], "readonly", (tx, done) => {
          tx.objectStore("bookmarks").index("savedAt").getAll().onsuccess = event => done(event.target.result.filter(validBookmark).reverse());
        });
      },
      async put(record) {
        if (!validBookmark(record)) throw new Error("저장할 카드 형식 오류");
        return transaction(db, ["bookmarks"], "readwrite", tx => tx.objectStore("bookmarks").put(record));
      },
      async remove(id) {
        if (!validId(id)) throw new Error("저장 카드 ID 오류");
        return transaction(db, ["bookmarks"], "readwrite", tx => tx.objectStore("bookmarks").delete(id));
      },
      async recover(record) {
        if (!validBookmark(record)) throw new Error("복원 카드 형식 오류");
        return transaction(db, ["bookmarks"], "readwrite", (tx, done) => {
          const store = tx.objectStore("bookmarks");
          store.get(record.id).onsuccess = event => {
            const existing = event.target.result;
            if (!existing || existing.card) { done(existing || null); return; }
            const recovered = { ...record, savedAt: existing.savedAt };
            try { store.put(recovered); done(recovered); } catch { tx.abort(); }
          };
        });
      }
    };
  } catch (error) { db.close(); throw error; }
}
