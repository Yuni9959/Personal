// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-11-16",
  "effectiveThrough": "2026-11-22",
  "calculatedAt": "2026-11-16T07:46:25.792+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "Yahoo NQ daily (cloud)",
  "sourceSha256": "8a3b230d3f3fee58e67a065139e87f135b3002c2a9aabfcbab7fb6245f1b255f",
  "fitStart": "2021-11-16",
  "fitEndExclusive": "2026-11-16",
  "holdoutStart": "2025-11-17",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.782217406370161,
  "bearPercent": 1.9942315116130045,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.782217406370161,
      "rangeRawSampleCount": 666,
      "rangeUsedSampleCount": 640,
      "safePercent": 0.7235285661983911,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.05812701829925,
      "selectionWilson95Low": 72.39849907877127,
      "walkForwardSampleCount": 135,
      "walkForwardHitRate": 82.22222222222221,
      "walkForwardWilson95Low": 74.90902943392975,
      "walkForwardWilson95High": 87.75236921382977,
      "walkForwardBlock95Low": 73.15386156465993,
      "walkForwardBlock95High": 90.151825633383,
      "currentWindowSampleCount": 666,
      "currentWindowUsedCount": 640
    },
    "bear": {
      "rangeMeanPercent": 1.9942315116130045,
      "rangeRawSampleCount": 591,
      "rangeUsedSampleCount": 564,
      "safePercent": 0.8378054527717271,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.20915896081021,
      "selectionWilson95Low": 73.3916702726311,
      "walkForwardSampleCount": 115,
      "walkForwardHitRate": 80.8695652173913,
      "walkForwardWilson95Low": 72.73005526487019,
      "walkForwardWilson95High": 87.01340522825919,
      "walkForwardBlock95Low": 70.43478260869566,
      "walkForwardBlock95High": 90.16430035128805,
      "currentWindowSampleCount": 591,
      "currentWindowUsedCount": 566
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.35494323381730936,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.5217905738513,
      "selectionWilson95Low": 73.30424008990711,
      "walkForwardSampleCount": 250,
      "walkForwardHitRate": 74,
      "walkForwardWilson95Low": 68.22862349629212,
      "walkForwardWilson95High": 79.04497812792654,
      "walkForwardBlock95Low": 68.42105263157895,
      "walkForwardBlock95High": 79.6812749003984,
      "currentWindowSampleCount": 1257,
      "currentWindowUsedCount": 1205
    },
    "down": {
      "safePercent": 0.3124737041454254,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.9359100769079,
      "selectionWilson95Low": 73.72452402053601,
      "walkForwardSampleCount": 250,
      "walkForwardHitRate": 77.60000000000001,
      "walkForwardWilson95Low": 72.03647189638117,
      "walkForwardWilson95High": 82.32816997147029,
      "walkForwardBlock95Low": 70.91633466135458,
      "walkForwardBlock95High": 83.66533864541833,
      "currentWindowSampleCount": 1257,
      "currentWindowUsedCount": 1199
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 22.0%, 하락 27.6%로 안전선에 부적합"
  }
});
