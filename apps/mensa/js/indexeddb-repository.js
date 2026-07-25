export const DATABASE_NAME = "mkat98-training-v2";
export const DATABASE_VERSION = 1;
export const STORE_NAMES = Object.freeze([
  "attempts",
  "sessions",
  "questionProgress",
  "meta"
]);

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true
    });
    request.addEventListener("error", () => {
      reject(request.error || new Error("IndexedDB 요청이 실패했습니다."));
    }, { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => {
      reject(transaction.error || new Error("IndexedDB 트랜잭션이 중단됐습니다."));
    }, { once: true });
    transaction.addEventListener("error", () => {
      reject(transaction.error || new Error("IndexedDB 트랜잭션이 실패했습니다."));
    }, { once: true });
  });
}

function createSchema(database) {
  if (!database.objectStoreNames.contains("attempts")) {
    const attempts = database.createObjectStore("attempts", {
      keyPath: "attemptId"
    });
    attempts.createIndex("bySessionId", "sessionId", { unique: false });
    attempts.createIndex("byQuestionId", "questionId", { unique: false });
    attempts.createIndex("byLocalDate", "localDate", { unique: false });
    attempts.createIndex("bySubmittedAt", "submittedAt", { unique: false });
  }

  if (!database.objectStoreNames.contains("sessions")) {
    const sessions = database.createObjectStore("sessions", {
      keyPath: "sessionId"
    });
    sessions.createIndex("byStatus", "status", { unique: false });
    sessions.createIndex("byStartedAt", "startedAt", { unique: false });
  }

  if (!database.objectStoreNames.contains("questionProgress")) {
    database.createObjectStore("questionProgress", {
      keyPath: "questionId"
    });
  }

  if (!database.objectStoreNames.contains("meta")) {
    database.createObjectStore("meta", { keyPath: "key" });
  }
}

function putSessionIfNewer(store, session) {
  const request = store.get(session.sessionId);
  request.addEventListener("success", () => {
    const existing = request.result;
    const incomingRevision = Number(session.sessionRevision || 0);
    const existingRevision = Number(existing?.sessionRevision || 0);
    const incomingUpdatedAt = Number(session.updatedAt || 0);
    const existingUpdatedAt = Number(existing?.updatedAt || 0);
    const isNewer =
      !existing ||
      incomingRevision > existingRevision ||
      (
        incomingRevision === existingRevision &&
        incomingUpdatedAt >= existingUpdatedAt
      );
    if (isNewer) store.put(session);
  }, { once: true });
}

export async function openTrainingDatabase(
  indexedDbImpl = globalThis.indexedDB
) {
  if (!indexedDbImpl || typeof indexedDbImpl.open !== "function") {
    throw new Error("이 브라우저에서는 IndexedDB를 사용할 수 없습니다.");
  }

  const request = indexedDbImpl.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    createSchema(request.result);
  });

  const database = await requestResult(request);
  database.addEventListener("versionchange", () => database.close());
  return database;
}

export class IndexedDbTrainingRepository {
  constructor(database) {
    this.database = database;
  }

  async getAll(storeName) {
    const transaction = this.database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    const result = await requestResult(request);
    await transactionDone(transaction);
    return result;
  }

  async getMeta(key) {
    const transaction = this.database.transaction("meta", "readonly");
    const request = transaction.objectStore("meta").get(key);
    const record = await requestResult(request);
    await transactionDone(transaction);
    return record?.value;
  }

  async putMeta(key, value) {
    return this.putMetaMany([{ key, value }]);
  }

  async putMetaMany(records) {
    const transaction = this.database.transaction("meta", "readwrite");
    const store = transaction.objectStore("meta");
    records.forEach(record => store.put(record));
    await transactionDone(transaction);
  }

  async putSession(session) {
    const transaction = this.database.transaction("sessions", "readwrite");
    putSessionIfNewer(transaction.objectStore("sessions"), session);
    await transactionDone(transaction);
  }

  async getSessionsByStatus(status) {
    const transaction = this.database.transaction("sessions", "readonly");
    const request = transaction
      .objectStore("sessions")
      .index("byStatus")
      .getAll(status);
    const result = await requestResult(request);
    await transactionDone(transaction);
    return result;
  }

  async replaceQuestionProgress(records) {
    const transaction = this.database.transaction(
      "questionProgress",
      "readwrite"
    );
    const store = transaction.objectStore("questionProgress");
    store.clear();
    records.forEach(record => store.put(record));
    await transactionDone(transaction);
  }

  async commitAttempt({
    attempt,
    session,
    questionProgress,
    revision
  }) {
    const transaction = this.database.transaction(
      ["attempts", "sessions", "questionProgress", "meta"],
      "readwrite"
    );
    transaction.objectStore("attempts").put(attempt);
    if (session) {
      putSessionIfNewer(transaction.objectStore("sessions"), session);
    }
    if (questionProgress) {
      transaction
        .objectStore("questionProgress")
        .put(questionProgress);
    }
    transaction.objectStore("meta").put({ key: "revision", value: revision });
    await transactionDone(transaction);
  }

  async commitAttempts({
    attempts,
    session,
    questionProgressRecords,
    revision
  }) {
    const transaction = this.database.transaction(
      ["attempts", "sessions", "questionProgress", "meta"],
      "readwrite"
    );
    const attemptStore = transaction.objectStore("attempts");
    const progressStore = transaction.objectStore("questionProgress");
    attempts.forEach(attempt => attemptStore.put(attempt));
    if (session) {
      putSessionIfNewer(transaction.objectStore("sessions"), session);
    }
    questionProgressRecords.forEach(record => progressStore.put(record));
    transaction.objectStore("meta").put({ key: "revision", value: revision });
    await transactionDone(transaction);
  }

  async reset(metaRecords) {
    const transaction = this.database.transaction(STORE_NAMES, "readwrite");
    STORE_NAMES.forEach(name => transaction.objectStore(name).clear());
    const metaStore = transaction.objectStore("meta");
    metaRecords.forEach(record => metaStore.put(record));
    await transactionDone(transaction);
  }

  async exportAll() {
    const entries = await Promise.all(
      STORE_NAMES.map(async name => [name, await this.getAll(name)])
    );
    return Object.fromEntries(entries);
  }

  close() {
    this.database.close();
  }
}

export async function openTrainingRepository(indexedDbImpl) {
  const database = await openTrainingDatabase(indexedDbImpl);
  return new IndexedDbTrainingRepository(database);
}
