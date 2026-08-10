import {
  DATABASE_NAME,
  STORE_NAMES,
  openTrainingRepository
} from "./indexeddb-repository.js";
import {
  DEFAULT_SETTINGS,
  LEGACY_STATS_KEY,
  RECOVERY_JOURNAL_KEY,
  STATS_SCHEMA_VERSION,
  SUMMARY_CACHE_KEY,
  blankLegacyStats,
  buildStatsSummary,
  localDateKey,
  normalizeLegacyStats
} from "./stats-model.js";
import {
  applyAttemptToProgress,
  rebuildQuestionProgress
} from "./mastery-engine.js";

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function uniqueRecoveryEntries(entries) {
  return [...new Map(
    entries
      .filter(entry => typeof entry?.entryId === "string" && entry.entryId)
      .map(entry => [entry.entryId, entry])
  ).values()];
}

function sessionIsNewer(incoming, existing) {
  if (!existing) return true;
  const incomingRevision = Number(incoming.sessionRevision || 0);
  const existingRevision = Number(existing.sessionRevision || 0);
  if (incomingRevision !== existingRevision) {
    return incomingRevision > existingRevision;
  }
  return Number(incoming.updatedAt || 0) >= Number(existing.updatedAt || 0);
}

export class MemoryTrainingRepository {
  constructor() {
    this.stores = Object.fromEntries(
      STORE_NAMES.map(name => [name, new Map()])
    );
  }

  async getAll(storeName) {
    return [...this.stores[storeName].values()].map(clone);
  }

  async getMeta(key) {
    return clone(this.stores.meta.get(key)?.value);
  }

  async putMeta(key, value) {
    this.stores.meta.set(key, { key, value: clone(value) });
  }

  async putMetaMany(records) {
    records.forEach(record => {
      this.stores.meta.set(record.key, clone(record));
    });
  }

  async putSession(session) {
    const existing = this.stores.sessions.get(session.sessionId);
    if (sessionIsNewer(session, existing)) {
      this.stores.sessions.set(session.sessionId, clone(session));
    }
  }

  async getSessionsByStatus(status) {
    return [...this.stores.sessions.values()]
      .filter(session => session.status === status)
      .map(clone);
  }

  async replaceQuestionProgress(records) {
    this.stores.questionProgress.clear();
    records.forEach(record => {
      this.stores.questionProgress.set(record.questionId, clone(record));
    });
  }

  async commitAttempt({
    attempt,
    session,
    questionProgress,
    revision
  }) {
    this.stores.attempts.set(attempt.attemptId, clone(attempt));
    if (session) await this.putSession(session);
    if (questionProgress) {
      this.stores.questionProgress.set(
        questionProgress.questionId,
        clone(questionProgress)
      );
    }
    this.stores.meta.set("revision", {
      key: "revision",
      value: revision
    });
  }

  async commitAttempts({
    attempts,
    session,
    questionProgressRecords,
    revision
  }) {
    attempts.forEach(attempt => {
      this.stores.attempts.set(attempt.attemptId, clone(attempt));
    });
    if (session) await this.putSession(session);
    questionProgressRecords.forEach(record => {
      this.stores.questionProgress.set(record.questionId, clone(record));
    });
    this.stores.meta.set("revision", {
      key: "revision",
      value: revision
    });
  }

  async reset(metaRecords) {
    STORE_NAMES.forEach(name => this.stores[name].clear());
    await this.putMetaMany(metaRecords);
  }

  async exportAll() {
    const entries = await Promise.all(
      STORE_NAMES.map(async name => [name, await this.getAll(name)])
    );
    return Object.fromEntries(entries);
  }

  close() {}
}

export class TrainingStore {
  constructor({
    repository,
    localStorageImpl = globalThis.localStorage,
    durable = true,
    initialError = null,
    now = () => Date.now()
  }) {
    this.repository = repository;
    this.localStorage = localStorageImpl;
    this.durable = durable;
    this.now = now;
    this.bankVersion = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.legacyStats = blankLegacyStats();
    this.migrationState = {};
    this.revision = 0;
    this.attemptsById = new Map();
    this.questionProgressById = new Map();
    this.volatileRecovery = [];
    this.summary = null;
    this.writeChain = Promise.resolve();
    this.health = {
      durable,
      cacheAvailable: true,
      recoveryPending: 0,
      lastError: initialError ? errorMessage(initialError) : null
    };
  }

  async initialize({ bankVersion }) {
    this.bankVersion = bankVersion;
    await this.ensureMetadata();
    if (this.durable) await this.flushRecovery();

    const attempts = await this.repository.getAll("attempts");
    this.attemptsById = new Map(
      attempts.map(attempt => [attempt.attemptId, attempt])
    );
    for (const entry of [
      ...this.readRecoveryEntries(),
      ...this.volatileRecovery
    ]) {
      if (entry.kind === "attempt" && entry.attempt?.attemptId) {
        this.attemptsById.set(entry.attempt.attemptId, entry.attempt);
      } else if (entry.kind === "attempt-batch") {
        for (const attempt of entry.attempts || []) {
          if (attempt?.attemptId) {
            this.attemptsById.set(attempt.attemptId, attempt);
          }
        }
      }
    }
    this.questionProgressById = rebuildQuestionProgress(
      [...this.attemptsById.values()]
    );
    try {
      await this.repository.replaceQuestionProgress(
        [...this.questionProgressById.values()]
      );
    } catch (error) {
      // questionProgress는 attempts에서 언제든 재생성할 수 있는 파생값이다.
      this.health.lastError = errorMessage(error);
    }
    return this.rebuildSummary({ writeCache: true });
  }

  enqueue(operation) {
    const task = this.writeChain.then(operation, operation);
    this.writeChain = task.catch(() => {});
    return task;
  }

  safeGetItem(key) {
    try {
      if (typeof this.localStorage?.getItem !== "function") {
        throw new Error("localStorage를 사용할 수 없습니다.");
      }
      return this.localStorage.getItem(key);
    } catch (error) {
      this.health.cacheAvailable = false;
      this.health.lastError = errorMessage(error);
      return null;
    }
  }

  safeSetItem(key, value) {
    try {
      if (typeof this.localStorage?.setItem !== "function") {
        throw new Error("localStorage를 사용할 수 없습니다.");
      }
      this.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      this.health.cacheAvailable = false;
      this.health.lastError = errorMessage(error);
      return false;
    }
  }

  safeRemoveItem(key) {
    try {
      if (typeof this.localStorage?.removeItem !== "function") {
        throw new Error("localStorage를 사용할 수 없습니다.");
      }
      this.localStorage.removeItem(key);
      return true;
    } catch (error) {
      this.health.cacheAvailable = false;
      this.health.lastError = errorMessage(error);
      return false;
    }
  }

  async ensureMetadata() {
    let migrationState = await this.repository.getMeta("migrationState");

    if (!migrationState) {
      const rawLegacy = this.safeGetItem(LEGACY_STATS_KEY);
      let parsedLegacy = null;
      let parseError = null;

      if (rawLegacy != null) {
        try {
          parsedLegacy = JSON.parse(rawLegacy);
        } catch (error) {
          parseError = errorMessage(error);
        }
      }

      const legacyStats = normalizeLegacyStats(parsedLegacy);
      const completedAt = this.now();
      migrationState = {
        migrationVersion: 1,
        completedAt,
        sourceKey: LEGACY_STATS_KEY,
        sourceFound: rawLegacy != null,
        sourceValid: rawLegacy == null || parseError == null,
        legacyPracticeDays: Object.keys(legacyStats.solvedByDate).sort(),
        legacyStreak: legacyStats.streak,
        officialGoalCompletionsImported: false,
        noticeDismissedAt: null,
        bankVersionAtMigration: this.bankVersion
      };

      await this.repository.putMetaMany([
        { key: "migrationState", value: migrationState },
        { key: "legacyStats", value: legacyStats },
        {
          key: "legacyBackup",
          value: {
            capturedAt: completedAt,
            raw: rawLegacy,
            parsed: parsedLegacy,
            parseError
          }
        },
        { key: "settings", value: { ...DEFAULT_SETTINGS } },
        { key: "revision", value: 0 },
        {
          key: "bankMetadata",
          value: {
            bankVersion: this.bankVersion,
            updatedAt: completedAt
          }
        }
      ]);
    }

    const [
      legacyStats,
      settings,
      revision,
      bankMetadata
    ] = await Promise.all([
      this.repository.getMeta("legacyStats"),
      this.repository.getMeta("settings"),
      this.repository.getMeta("revision"),
      this.repository.getMeta("bankMetadata")
    ]);

    if (bankMetadata?.bankVersion !== this.bankVersion) {
      await this.repository.putMeta("bankMetadata", {
        bankVersion: this.bankVersion,
        previousBankVersion: bankMetadata?.bankVersion || null,
        updatedAt: this.now()
      });
    }

    this.migrationState = migrationState;
    this.legacyStats = normalizeLegacyStats(legacyStats);
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(settings && typeof settings === "object" ? settings : {})
    };
    this.revision = Number.isInteger(revision) && revision >= 0 ? revision : 0;
  }

  readRecoveryEntries() {
    const raw = this.safeGetItem(RECOVERY_JOURNAL_KEY);
    if (!raw) return [];

    try {
      const journal = JSON.parse(raw);
      return Array.isArray(journal?.entries) ? journal.entries : [];
    } catch (error) {
      this.health.lastError = `복구 저널 손상: ${errorMessage(error)}`;
      return [];
    }
  }

  writeRecoveryEntries(entries) {
    const unique = uniqueRecoveryEntries(entries);
    this.health.recoveryPending = unique.length;

    if (!unique.length) {
      return this.safeRemoveItem(RECOVERY_JOURNAL_KEY);
    }

    return this.safeSetItem(
      RECOVERY_JOURNAL_KEY,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: this.now(),
        entries: unique
      })
    );
  }

  queueRecovery(entry) {
    const combined = uniqueRecoveryEntries([
      ...this.readRecoveryEntries(),
      ...this.volatileRecovery,
      entry
    ]);

    if (this.writeRecoveryEntries(combined)) {
      this.volatileRecovery = [];
    } else {
      this.volatileRecovery = combined;
      this.health.recoveryPending = combined.length;
    }
  }

  async flushRecovery() {
    if (!this.durable) return;

    const stored = this.readRecoveryEntries();
    const combined = [...stored, ...this.volatileRecovery];
    const unique = uniqueRecoveryEntries(combined);
    const remaining = [];

    for (const entry of unique) {
      try {
        if (entry.kind === "attempt") {
          const nextRevision = this.revision + 1;
          await this.repository.commitAttempt({
            attempt: entry.attempt,
            session: entry.session || null,
            questionProgress: entry.questionProgress || null,
            revision: nextRevision
          });
          this.revision = nextRevision;
        } else if (entry.kind === "attempt-batch") {
          const attempts = Array.isArray(entry.attempts)
            ? entry.attempts
            : [];
          const nextRevision = this.revision + attempts.length;
          await this.repository.commitAttempts({
            attempts,
            session: entry.session || null,
            questionProgressRecords:
              entry.questionProgressRecords || [],
            revision: nextRevision
          });
          this.revision = nextRevision;
        } else if (entry.kind === "session") {
          await this.repository.putSession(entry.session);
        } else if (entry.kind === "meta") {
          await this.repository.putMeta(entry.key, entry.value);
        }
      } catch (error) {
        remaining.push(entry);
        this.health.lastError = errorMessage(error);
      }
    }

    this.volatileRecovery = remaining;
    if (this.writeRecoveryEntries(remaining)) {
      this.volatileRecovery = [];
    } else {
      this.health.recoveryPending = remaining.length;
    }
  }

  storageSnapshot() {
    return {
      durable: this.health.durable,
      cacheAvailable: this.health.cacheAvailable,
      recoveryPending: this.health.recoveryPending,
      lastError: this.health.lastError
    };
  }

  getQuestionProgress(questionId) {
    const progress = this.questionProgressById.get(questionId);
    return progress ? clone(progress) : null;
  }

  getAllQuestionProgress() {
    return [...this.questionProgressById.values()].map(clone);
  }

  rebuildSummary({ writeCache }) {
    const summary = buildStatsSummary({
      attempts: [...this.attemptsById.values()],
      questionProgress: [...this.questionProgressById.values()],
      legacyStats: this.legacyStats,
      settings: this.settings,
      migrationState: this.migrationState,
      bankVersion: this.bankVersion,
      revision: this.revision,
      now: new Date(this.now())
    });

    this.summary = {
      ...summary,
      storage: this.storageSnapshot()
    };

    if (writeCache) {
      const written = this.safeSetItem(
        SUMMARY_CACHE_KEY,
        JSON.stringify(this.summary)
      );
      if (!written) {
        this.summary.storage = this.storageSnapshot();
      }
    }

    return this.summary;
  }

  async saveSession(session) {
    return this.enqueue(async () => {
      try {
        await this.repository.putSession(session);
        if (!this.durable) {
          this.queueRecovery({
            kind: "session",
            entryId:
              `session:${session.sessionId}:` +
              `${session.sessionRevision || 0}:${session.updatedAt}`,
            session
          });
        }
        return { saved: this.durable, queuedForRecovery: !this.durable };
      } catch (error) {
        this.health.lastError = errorMessage(error);
        this.queueRecovery({
          kind: "session",
          entryId:
            `session:${session.sessionId}:` +
            `${session.sessionRevision || 0}:${session.updatedAt}`,
          session
        });
        return { saved: false, queuedForRecovery: true };
      }
    });
  }

  async getSessionsByStatus(status) {
    await this.writeChain;
    try {
      const sessions = await this.repository.getSessionsByStatus(status);
      return sessions.sort(
        (left, right) =>
          Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
      );
    } catch (error) {
      this.health.lastError = errorMessage(error);
      return [];
    }
  }

  getAllAttempts() {
    return [...this.attemptsById.values()].map(clone);
  }

  async getDailyQueues() {
    await this.writeChain;
    try {
      const queues = await this.repository.getMeta("dailyQueues");
      return queues && typeof queues === "object"
        ? clone(queues)
        : {};
    } catch (error) {
      this.health.lastError = errorMessage(error);
      return {};
    }
  }

  async getDailyQueue(date) {
    const queues = await this.getDailyQueues();
    return queues[date] || null;
  }

  async saveDailyQueue(queue) {
    return this.enqueue(async () => {
      let queues = {};
      try {
        const stored = await this.repository.getMeta("dailyQueues");
        if (stored && typeof stored === "object") queues = stored;
      } catch (error) {
        this.health.lastError = errorMessage(error);
      }

      queues = {
        ...queues,
        [queue.date]: clone(queue)
      };
      const retainedDates = Object.keys(queues).sort().slice(-45);
      queues = Object.fromEntries(
        retainedDates.map(date => [date, queues[date]])
      );
      const recovery = {
        kind: "meta",
        entryId: `meta:dailyQueues:${queue.date}:${queue.updatedAt}`,
        key: "dailyQueues",
        value: queues
      };

      try {
        await this.repository.putMeta("dailyQueues", queues);
        if (!this.durable) this.queueRecovery(recovery);
        return { saved: this.durable, queue: clone(queue) };
      } catch (error) {
        this.health.lastError = errorMessage(error);
        this.queueRecovery(recovery);
        return { saved: false, queue: clone(queue) };
      }
    });
  }

  async recordAttempt(attempt, session) {
    return this.enqueue(async () => {
      if (this.attemptsById.has(attempt.attemptId)) {
        return {
          saved: true,
          queuedForRecovery: false,
          duplicate: true,
          summary: this.summary,
          storage: this.storageSnapshot()
        };
      }

      const nextRevision = this.revision + 1;
      const questionProgress = applyAttemptToProgress(
        this.questionProgressById.get(attempt.questionId),
        attempt
      );
      let saved = false;
      let queuedForRecovery = false;

      try {
        await this.repository.commitAttempt({
          attempt,
          session,
          questionProgress,
          revision: nextRevision
        });
        this.revision = nextRevision;
        saved = this.durable;

        if (!this.durable) {
          queuedForRecovery = true;
          this.queueRecovery({
            kind: "attempt",
            entryId: `attempt:${attempt.attemptId}`,
            attempt,
            session,
            questionProgress
          });
        }
      } catch (error) {
        this.health.lastError = errorMessage(error);
        queuedForRecovery = true;
        this.queueRecovery({
          kind: "attempt",
          entryId: `attempt:${attempt.attemptId}`,
          attempt,
          session,
          questionProgress
        });
      }

      this.attemptsById.set(attempt.attemptId, attempt);
      this.questionProgressById.set(
        questionProgress.questionId,
        questionProgress
      );
      const summary = this.rebuildSummary({
        writeCache: saved || queuedForRecovery
      });

      return {
        saved,
        queuedForRecovery,
        summary,
        storage: this.storageSnapshot()
      };
    });
  }

  async recordAttemptBatch(attempts, session) {
    return this.enqueue(async () => {
      const unique = [...new Map(
        (attempts || [])
          .filter(attempt => attempt?.attemptId)
          .map(attempt => [attempt.attemptId, attempt])
      ).values()];
      const pending = unique.filter(
        attempt => !this.attemptsById.has(attempt.attemptId)
      );

      if (!pending.length) {
        if (session) await this.repository.putSession(session);
        return {
          saved: true,
          queuedForRecovery: false,
          duplicate: true,
          summary: this.summary,
          storage: this.storageSnapshot()
        };
      }

      const progressById = new Map(
        [...this.questionProgressById.entries()].map(([id, progress]) => [
          id,
          clone(progress)
        ])
      );
      for (const attempt of pending) {
        progressById.set(
          attempt.questionId,
          applyAttemptToProgress(
            progressById.get(attempt.questionId),
            attempt
          )
        );
      }
      const affectedQuestionIds = new Set(
        pending.map(attempt => attempt.questionId)
      );
      const questionProgressRecords = [...affectedQuestionIds].map(
        questionId => progressById.get(questionId)
      );
      const nextRevision = this.revision + pending.length;
      const recovery = {
        kind: "attempt-batch",
        entryId:
          `attempt-batch:${session?.sessionId || "unknown"}:` +
          pending.map(attempt => attempt.attemptId).join(","),
        attempts: pending,
        session,
        questionProgressRecords
      };
      let saved = false;
      let queuedForRecovery = false;

      try {
        await this.repository.commitAttempts({
          attempts: pending,
          session,
          questionProgressRecords,
          revision: nextRevision
        });
        this.revision = nextRevision;
        saved = this.durable;
        if (!this.durable) {
          queuedForRecovery = true;
          this.queueRecovery(recovery);
        }
      } catch (error) {
        this.health.lastError = errorMessage(error);
        queuedForRecovery = true;
        this.queueRecovery(recovery);
      }

      pending.forEach(attempt => {
        this.attemptsById.set(attempt.attemptId, attempt);
      });
      questionProgressRecords.forEach(progress => {
        this.questionProgressById.set(progress.questionId, progress);
      });
      const summary = this.rebuildSummary({
        writeCache: saved || queuedForRecovery
      });

      return {
        saved,
        queuedForRecovery,
        duplicate: false,
        recorded: pending.length,
        summary,
        storage: this.storageSnapshot()
      };
    });
  }

  async dismissMigrationNotice() {
    return this.enqueue(async () => {
      this.migrationState = {
        ...this.migrationState,
        noticeDismissedAt: this.now()
      };

      try {
        await this.repository.putMeta(
          "migrationState",
          this.migrationState
        );
      } catch (error) {
        this.health.lastError = errorMessage(error);
      }

      return this.rebuildSummary({ writeCache: true });
    });
  }

  async reset() {
    return this.enqueue(async () => {
      const resetAt = this.now();
      const migrationState = {
        migrationVersion: 1,
        completedAt: resetAt,
        resetAt,
        sourceKey: LEGACY_STATS_KEY,
        sourceFound: false,
        sourceValid: true,
        legacyPracticeDays: [],
        legacyStreak: 0,
        officialGoalCompletionsImported: false,
        noticeDismissedAt: resetAt,
        bankVersionAtMigration: this.bankVersion
      };
      const metaRecords = [
        { key: "migrationState", value: migrationState },
        { key: "legacyStats", value: blankLegacyStats() },
        {
          key: "legacyBackup",
          value: { capturedAt: resetAt, resetAt, raw: null, parsed: null }
        },
        { key: "settings", value: { ...DEFAULT_SETTINGS } },
        { key: "revision", value: 0 },
        {
          key: "bankMetadata",
          value: {
            bankVersion: this.bankVersion,
            updatedAt: resetAt
          }
        }
      ];

      await this.repository.reset(metaRecords);
      this.safeRemoveItem(LEGACY_STATS_KEY);
      this.safeRemoveItem(RECOVERY_JOURNAL_KEY);
      this.safeRemoveItem(SUMMARY_CACHE_KEY);

      this.legacyStats = blankLegacyStats();
      this.migrationState = migrationState;
      this.settings = { ...DEFAULT_SETTINGS };
      this.revision = 0;
      this.attemptsById.clear();
      this.questionProgressById.clear();
      this.volatileRecovery = [];
      this.health.recoveryPending = 0;
      this.health.lastError = null;

      return this.rebuildSummary({ writeCache: true });
    });
  }

  async exportData() {
    await this.writeChain;
    const data = await this.repository.exportAll();
    const recoveryEntries = [
      ...this.readRecoveryEntries(),
      ...this.volatileRecovery
    ];

    return {
      exportSchemaVersion: 1,
      statsSchemaVersion: STATS_SCHEMA_VERSION,
      databaseName: DATABASE_NAME,
      bankVersion: this.bankVersion,
      exportedAt: new Date(this.now()).toISOString(),
      storage: this.storageSnapshot(),
      summary: this.summary,
      recoveryEntries,
      data
    };
  }

  close() {
    this.repository.close?.();
  }
}

export async function createTrainingStore({
  bankVersion,
  indexedDbImpl = globalThis.indexedDB,
  localStorageImpl = globalThis.localStorage,
  now = () => Date.now(),
  repositoryFactory = openTrainingRepository
}) {
  let repository;
  let durable = true;
  let initialError = null;

  try {
    repository = await repositoryFactory(indexedDbImpl);
  } catch (error) {
    repository = new MemoryTrainingRepository();
    durable = false;
    initialError = error;
  }

  let store = new TrainingStore({
    repository,
    localStorageImpl,
    durable,
    initialError,
    now
  });

  try {
    await store.initialize({ bankVersion });
  } catch (error) {
    repository.close?.();
    store = new TrainingStore({
      repository: new MemoryTrainingRepository(),
      localStorageImpl,
      durable: false,
      initialError: error,
      now
    });
    await store.initialize({ bankVersion });
  }

  return store;
}

export function downloadTrainingExport(
  exportData,
  {
    documentImpl = globalThis.document,
    urlImpl = globalThis.URL,
    BlobImpl = globalThis.Blob
  } = {}
) {
  const blob = new BlobImpl(
    [`${JSON.stringify(exportData, null, 2)}\n`],
    { type: "application/json;charset=utf-8" }
  );
  const objectUrl = urlImpl.createObjectURL(blob);
  const link = documentImpl.createElement("a");
  const date = localDateKey(new Date(exportData.exportedAt));
  link.href = objectUrl;
  link.download = `mkat98-training-${date}.json`;
  link.hidden = true;
  documentImpl.body.appendChild(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => urlImpl.revokeObjectURL(objectUrl), 0);
}
