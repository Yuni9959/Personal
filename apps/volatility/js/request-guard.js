export const REQUEST_COOLDOWN_MS = 60_000;
export const REQUEST_DEADLINE_MS = 7_000;
export const REQUEST_LEASE_MS = REQUEST_DEADLINE_MS + 5_000;
export const REQUEST_LOCK_NAME = "personal-tap-volatility-market-request-v1";
export const REQUEST_LEASE_KEY = "personal-tap-volatility-request-lease-v1";

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
  const requestedAt = Math.max(finitePositive(memoryRequestedAt), finitePositive(storedRequestedAt));
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
  if (locks?.request) {
    return locks.request(REQUEST_LOCK_NAME, { ifAvailable: true }, async lock => {
      if (!lock) return { acquired: false, reason: "lock-held" };
      return { acquired: true, value: await operation() };
    });
  }
  return withStorageLease(operation, {
    storage: options.storage ?? globalThis.localStorage,
    clock: options.clock ?? Date.now,
    sleep: options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    cryptoImpl: options.cryptoImpl ?? globalThis.crypto
  });
}
