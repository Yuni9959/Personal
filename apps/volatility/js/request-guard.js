// This is only a short duplicate-click guard. Provider-directed 429 backoff is
// deliberately independent and remains at least one minute below.
export const REQUEST_COOLDOWN_MS = 10_000;
// Jina Reader is deliberately used only for a user-triggered, one-shot read.
// Its documented average latency is about eight seconds, so the old seven
// second deadline rejected otherwise valid responses before they arrived.
export const REQUEST_DEADLINE_MS = 15_000;
export const REQUEST_LEASE_MS = REQUEST_DEADLINE_MS + 5_000;
export const RATE_LIMIT_MINIMUM_MS = 60_000;
export const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60_000;
export const REQUEST_LOCK_NAME = "personal-tap-volatility-market-request-v1";
export const REQUEST_LEASE_KEY = "personal-tap-volatility-request-lease-v1";
export const REQUEST_STORAGE_PROBE_KEY = "personal-tap-volatility-storage-probe-v1";

function finitePositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function calculateCooldown({
  now,
  memoryRequestedAt = 0,
  storedRequestedAt = 0,
  cooldownMs = REQUEST_COOLDOWN_MS
}) {
  const current = Number(now);
  if (!Number.isFinite(current)) throw new TypeError("현재 시각은 유효한 숫자여야 합니다.");
  const memoryAt = finitePositive(memoryRequestedAt);
  const storedAt = finitePositive(storedRequestedAt);
  // The ordinary guard is short enough to preserve across reloads and tabs.
  // This prevents a just-finished request or a wall-clock rollback from being
  // bypassed merely because the new page has not rendered a usable quote yet.
  const requestedAt = Math.max(memoryAt, storedAt);
  if (!requestedAt) return { requestedAt: 0, remainingMs: 0, rebaseAt: null };
  if (requestedAt > current) {
    return { requestedAt, remainingMs: cooldownMs, rebaseAt: current };
  }
  return {
    requestedAt,
    remainingMs: Math.max(0, cooldownMs - (current - requestedAt)),
    rebaseAt: null
  };
}

export function rateLimitUntilFromMetadata({
  now,
  retryAfterSeconds = null,
  retryAt = null,
  minimumMs = RATE_LIMIT_MINIMUM_MS,
  maximumMs = MAX_RATE_LIMIT_BACKOFF_MS
}) {
  const current = Number(now);
  if (!Number.isFinite(current)) throw new TypeError("현재 시각은 유효한 숫자여야 합니다.");
  const candidates = [];
  const seconds = Number(retryAfterSeconds);
  if (retryAfterSeconds !== null && retryAfterSeconds !== "" &&
      Number.isFinite(seconds) && seconds >= 0) {
    candidates.push(current + seconds * 1000);
  }
  const absolute = Date.parse(String(retryAt || ""));
  if (Number.isFinite(absolute)) candidates.push(absolute);
  // A 429 without a readable Retry-After header is still a provider-directed
  // throttle. Keep it separate from the short duplicate-click cooldown and
  // fail closed for at least one minute.
  if (!candidates.length) return current + minimumMs;
  const delay = Math.min(maximumMs, Math.max(minimumMs, Math.max(...candidates) - current));
  return current + delay;
}

export function calculateRateLimitBackoff({
  now,
  storedUntil = 0,
  maximumMs = MAX_RATE_LIMIT_BACKOFF_MS
}) {
  const current = Number(now);
  if (!Number.isFinite(current)) throw new TypeError("현재 시각은 유효한 숫자여야 합니다.");
  const until = Number(storedUntil);
  if (!Number.isFinite(until) || until <= current) {
    return { remainingMs: 0, rebaseAt: null };
  }
  if (until - current > maximumMs) {
    return { remainingMs: maximumMs, rebaseAt: current + maximumMs };
  }
  return { remainingMs: until - current, rebaseAt: null };
}

function readLease(storage) {
  try {
    const raw = storage.getItem(REQUEST_LEASE_KEY);
    if (raw === null || raw === "") return { available: true, lease: {} };
    const lease = JSON.parse(raw);
    if (!lease || typeof lease !== "object" || Array.isArray(lease)) {
      return { available: false, lease: {} };
    }
    return { available: true, lease };
  } catch {
    return { available: false, lease: {} };
  }
}

function writeLease(storage, value) {
  try {
    storage?.setItem?.(REQUEST_LEASE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function hasWritableStorage(storage, token) {
  try {
    if (typeof storage?.getItem !== "function" ||
        typeof storage?.setItem !== "function" ||
        typeof storage?.removeItem !== "function") return false;
    // The reserved probe is disposable. Removing it first verifies that a
    // stale probe from a crashed page cannot make an in-place update look like
    // enough free storage for a new cooldown/backoff key.
    storage.removeItem(REQUEST_STORAGE_PROBE_KEY);
    if (storage.getItem(REQUEST_STORAGE_PROBE_KEY) !== null) return false;
    storage.setItem(REQUEST_STORAGE_PROBE_KEY, token);
    if (storage.getItem(REQUEST_STORAGE_PROBE_KEY) !== token) return false;
    storage.removeItem(REQUEST_STORAGE_PROBE_KEY);
    return storage.getItem(REQUEST_STORAGE_PROBE_KEY) === null;
  } catch {
    return false;
  }
}

function leaseToken(cryptoImpl, now) {
  return cryptoImpl?.randomUUID?.() || `${now}-${Math.random().toString(16).slice(2)}`;
}

async function withStorageLease(operation, { storage, clock, sleep, cryptoImpl }) {
  try {
    if (typeof storage?.getItem !== "function" || typeof storage?.setItem !== "function") {
      return { acquired: false, reason: "storage-unavailable" };
    }
  } catch {
    return { acquired: false, reason: "storage-unavailable" };
  }
  const now = clock();
  if (!Number.isFinite(now)) return { acquired: false, reason: "clock-unavailable" };
  const existing = readLease(storage);
  if (!existing.available) return { acquired: false, reason: "storage-unavailable" };
  if (Number(existing.lease.expiresAt) > now) return { acquired: false, reason: "lease-held" };
  const token = leaseToken(cryptoImpl, now);
  if (!writeLease(storage, { token, expiresAt: now + REQUEST_LEASE_MS })) {
    return { acquired: false, reason: "storage-unavailable" };
  }
  await sleep(40);
  const verified = readLease(storage);
  if (!verified.available) return { acquired: false, reason: "storage-unavailable" };
  if (verified.lease.token !== token) {
    return {
      acquired: false,
      reason: verified.lease.token ? "lease-lost" : "storage-unavailable"
    };
  }
  try {
    return { acquired: true, value: await operation() };
  } finally {
    const current = readLease(storage);
    if (current.available && current.lease.token === token) {
      try { storage.removeItem(REQUEST_LEASE_KEY); }
      catch { /* The bounded lease expires without cleanup. */ }
    }
  }
}

export async function withExclusiveRequest(operation, options = {}) {
  if (typeof operation !== "function") throw new TypeError("요청 작업 함수가 필요합니다.");
  const locks = options.locks ?? globalThis.navigator?.locks;
  const storage = options.storage ?? globalThis.localStorage;
  const clock = options.clock ?? Date.now;
  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  if (locks?.request) {
    return locks.request(REQUEST_LOCK_NAME, { ifAvailable: true }, async lock => {
      if (!lock) return { acquired: false, reason: "lock-held" };
      const now = clock();
      if (!Number.isFinite(now)) return { acquired: false, reason: "clock-unavailable" };
      const token = `storage-${leaseToken(cryptoImpl, now)}`;
      if (!hasWritableStorage(storage, token)) {
        return { acquired: false, reason: "storage-unavailable" };
      }
      return { acquired: true, value: await operation() };
    });
  }
  return withStorageLease(operation, {
    storage,
    clock,
    sleep: options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    cryptoImpl
  });
}
