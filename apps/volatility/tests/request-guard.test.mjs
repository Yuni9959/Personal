import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RATE_LIMIT_BACKOFF_MS,
  RATE_LIMIT_MINIMUM_MS,
  REQUEST_COOLDOWN_MS,
  REQUEST_LEASE_KEY,
  REQUEST_LEASE_MS,
  REQUEST_STORAGE_PROBE_KEY,
  calculateCooldown,
  calculateRateLimitBackoff,
  rateLimitUntilFromMetadata,
  withExclusiveRequest
} from "../js/request-guard.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); }
  };
}

test("rate-limit metadata preserves a 120-second Retry-After", () => {
  const now = 1_000_000;
  assert.equal(rateLimitUntilFromMetadata({ now, retryAfterSeconds: 120 }), now + 120_000);
});

test("rate-limit metadata uses the later valid absolute retry time", () => {
  const now = Date.parse("2026-08-14T12:00:00Z");
  assert.equal(rateLimitUntilFromMetadata({
    now,
    retryAfterSeconds: 90,
    retryAt: "2026-08-14T12:02:00Z"
  }), now + 120_000);
});

test("rate-limit metadata applies the minimum delay to a past or zero hint", () => {
  const now = Date.parse("2026-08-14T12:00:00Z");
  assert.equal(rateLimitUntilFromMetadata({ now, retryAfterSeconds: 0 }), now + 60_000);
  assert.equal(rateLimitUntilFromMetadata({
    now,
    retryAt: "2026-08-14T11:59:00Z"
  }), now + 60_000);
  assert.equal(RATE_LIMIT_MINIMUM_MS, 60_000);
});

test("rate-limit without a valid Retry-After still keeps the one-minute provider backoff", () => {
  assert.equal(rateLimitUntilFromMetadata({ now: 1_000_000 }), 1_060_000);
  assert.equal(
    rateLimitUntilFromMetadata({ now: 1_000_000, retryAfterSeconds: "invalid" }),
    1_060_000
  );
});

test("rate-limit metadata is capped at fifteen minutes", () => {
  const now = 1_000_000;
  assert.equal(
    rateLimitUntilFromMetadata({ now, retryAfterSeconds: 86_400 }),
    now + MAX_RATE_LIMIT_BACKOFF_MS
  );
});

test("persisted provider backoff preserves future time and expires normally", () => {
  const now = 1_000_000;
  assert.deepEqual(calculateRateLimitBackoff({ now, storedUntil: now + 120_000 }), {
    remainingMs: 120_000,
    rebaseAt: null
  });
  assert.deepEqual(calculateRateLimitBackoff({ now, storedUntil: now }), {
    remainingMs: 0,
    rebaseAt: null
  });
  assert.deepEqual(calculateRateLimitBackoff({ now, storedUntil: "corrupt" }), {
    remainingMs: 0,
    rebaseAt: null
  });
});

test("persisted far-future backoff is rebased fail-closed after clock rollback", () => {
  const now = 1_000_000;
  assert.deepEqual(calculateRateLimitBackoff({
    now,
    storedUntil: now + MAX_RATE_LIMIT_BACKOFF_MS + 1
  }), {
    remainingMs: MAX_RATE_LIMIT_BACKOFF_MS,
    rebaseAt: now + MAX_RATE_LIMIT_BACKOFF_MS
  });
});

test("일반 cooldown은 실제 요청 뒤 9,999ms를 차단하고 정확히 10,000ms부터 허용한다", () => {
  const now = 1_000_000;
  assert.equal(calculateCooldown({
    now, storedRequestedAt: now - 9_999
  }).remainingMs, 1);
  assert.equal(calculateCooldown({
    now, storedRequestedAt: now - 10_000
  }).remainingMs, 0);
  assert.equal(REQUEST_COOLDOWN_MS, 10_000);
});

test("시계가 뒤로 이동하면 즉시 허용하지 않고 현재시각으로 rebase해 전체 cooldown을 요구한다", () => {
  const result = calculateCooldown({ now: 1_000_000, storedRequestedAt: 1_010_000 });
  assert.equal(result.remainingMs, 10_000);
  assert.equal(result.rebaseAt, 1_000_000);
});

test("시가가 없어도 다른 화면의 실제 요청 뒤 9,999ms까지 일반 cooldown을 지킨다", () => {
  const now = 1_000_000;
  const result = calculateCooldown({
    now,
    storedRequestedAt: now - 9_999
  });
  assert.equal(result.remainingMs, 1);
});

test("시가가 없어도 다른 화면의 요청이 10초 지났으면 즉시 허용한다", () => {
  const now = 1_000_000;
  const result = calculateCooldown({
    now,
    storedRequestedAt: now - 10_000
  });
  assert.equal(result.remainingMs, 0);
});

test("시가가 없는 화면도 미래 요청시각을 현재로 rebase하고 10초를 요구한다", () => {
  const now = 1_000_000;
  const result = calculateCooldown({
    now,
    storedRequestedAt: now + 5_000
  });
  assert.equal(result.remainingMs, 10_000);
  assert.equal(result.rebaseAt, now);
});

test("동일 origin의 동시 요청은 Web Lock에서 한 작업만 획득한다", async () => {
  const storage = memoryStorage();
  let held = false;
  const locks = {
    async request(_name, _options, callback) {
      if (held) return callback(null);
      held = true;
      try { return await callback({ name: "lock" }); }
      finally { held = false; }
    }
  };
  let release;
  let calls = 0;
  const first = withExclusiveRequest(async () => {
    calls += 1;
    return new Promise(resolve => { release = resolve; });
  }, { locks, storage });
  await new Promise(resolve => setImmediate(resolve));
  const second = await withExclusiveRequest(async () => { calls += 1; }, { locks, storage });
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "lock-held");
  assert.equal(calls, 1);
  release("done");
  assert.deepEqual(await first, { acquired: true, value: "done" });
  assert.equal(storage.value(REQUEST_STORAGE_PROBE_KEY), undefined);
});

test("Web Lock이 있어도 영속 저장소를 검증할 수 없으면 네트워크 작업을 fail-closed한다", async t => {
  const locks = {
    async request(_name, _options, callback) { return callback({ name: "lock" }); }
  };
  const cases = [
    ["missing", undefined],
    ["read throws", {
      getItem() { throw new Error("SecurityError"); },
      setItem() {},
      removeItem() {}
    }],
    ["write throws", {
      getItem() { return null; },
      setItem() { throw new Error("QuotaExceededError"); },
      removeItem() {}
    }],
    ["silent no-op write", {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    }],
    ["silent no-op remove", (() => {
      const values = new Map();
      return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem() {}
      };
    })()]
  ];
  for (const [name, storage] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      const result = await withExclusiveRequest(async () => { calls += 1; }, {
        locks,
        storage,
        clock: () => 1_000_000,
        cryptoImpl: { randomUUID: () => "probe-token" }
      });
      assert.deepEqual(result, { acquired: false, reason: "storage-unavailable" });
      assert.equal(calls, 0);
    });
  }
});

test("Web Locks 미지원 환경에서는 storage lease를 검증한 뒤 한 요청만 실행하고 정리한다", async () => {
  const storage = memoryStorage();
  let calls = 0;
  const result = await withExclusiveRequest(async () => {
    calls += 1;
    return "snapshot";
  }, {
    locks: null,
    storage,
    clock: () => 1_000_000,
    sleep: async () => {},
    cryptoImpl: { randomUUID: () => "only-token" }
  });
  assert.deepEqual(result, { acquired: true, value: "snapshot" });
  assert.equal(calls, 1);
  assert.equal(storage.value(REQUEST_LEASE_KEY), undefined);
});

test("아직 유효한 storage lease가 있으면 operation을 실행하지 않는다", async () => {
  const now = 1_000_000;
  const storage = memoryStorage({
    [REQUEST_LEASE_KEY]: JSON.stringify({ token: "other-tab", expiresAt: now + 1 })
  });
  let calls = 0;
  const result = await withExclusiveRequest(async () => { calls += 1; }, {
    locks: null,
    storage,
    clock: () => now,
    sleep: async () => {}
  });
  assert.deepEqual(result, { acquired: false, reason: "lease-held" });
  assert.equal(calls, 0);
});

test("만료된 storage lease는 회수하고 새 요청을 실행한다", async () => {
  const now = 1_000_000;
  const storage = memoryStorage({
    [REQUEST_LEASE_KEY]: JSON.stringify({ token: "expired", expiresAt: now - 1 })
  });
  let calls = 0;
  const result = await withExclusiveRequest(async () => { calls += 1; return 7; }, {
    locks: null,
    storage,
    clock: () => now,
    sleep: async () => {},
    cryptoImpl: { randomUUID: () => "replacement" }
  });
  assert.deepEqual(result, { acquired: true, value: 7 });
  assert.equal(calls, 1);
  assert.equal(storage.value(REQUEST_LEASE_KEY), undefined);
  assert.equal(REQUEST_LEASE_MS, 20_000);
});

test("storage lease 확인 대기 중 다른 탭이 소유권을 가져가면 operation을 실행하지 않는다", async () => {
  const storage = memoryStorage();
  let calls = 0;
  const result = await withExclusiveRequest(async () => { calls += 1; }, {
    locks: null,
    storage,
    clock: () => 1_000_000,
    sleep: async () => {
      storage.setItem(REQUEST_LEASE_KEY, JSON.stringify({
        token: "other-tab",
        expiresAt: 1_000_000 + REQUEST_LEASE_MS
      }));
    },
    cryptoImpl: { randomUUID: () => "our-token" }
  });
  assert.deepEqual(result, { acquired: false, reason: "lease-lost" });
  assert.equal(calls, 0);
});

test("localStorage가 없거나 읽기·쓰기 차단되면 요청을 실행하지 않는 fail-closed 정책이다", async t => {
  const cases = [
    ["missing", undefined],
    ["read throws", {
      getItem() { throw new Error("SecurityError"); },
      setItem() {},
      removeItem() {}
    }],
    ["write throws", {
      getItem() { return null; },
      setItem() { throw new Error("QuotaExceededError"); },
      removeItem() {}
    }],
    ["silent no-op write", {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    }],
    ["corrupt lease", memoryStorage({ [REQUEST_LEASE_KEY]: "not-json" })]
  ];
  for (const [name, storage] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      const result = await withExclusiveRequest(async () => { calls += 1; }, {
        locks: null,
        storage,
        clock: () => 1_000_000,
        sleep: async () => {}
      });
      assert.equal(result.acquired, false);
      assert.equal(result.reason, "storage-unavailable");
      assert.equal(calls, 0);
    });
  }
});

test("operation 실패 시에도 자신이 소유한 lease를 정리하고 오류를 전파한다", async () => {
  const storage = memoryStorage();
  await assert.rejects(
    withExclusiveRequest(async () => { throw new Error("request failed"); }, {
      locks: null,
      storage,
      clock: () => 1_000_000,
      sleep: async () => {},
      cryptoImpl: { randomUUID: () => "failed-token" }
    }),
    /request failed/
  );
  assert.equal(storage.value(REQUEST_LEASE_KEY), undefined);
});
