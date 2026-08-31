// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-08-31",
  "effectiveThrough": "2026-09-06",
  "calculatedAt": "2026-09-01T08:30:21.001+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "7f61107112b3f57fc5d1ce525139bce8d1a94497ddf66d9527ed85d6ff4b0206",
  "fitStart": "2021-08-31",
  "fitEndExclusive": "2026-08-31",
  "holdoutStart": "2025-09-01",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7624955732525245,
  "bearPercent": 1.9610619145374437,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7624955732525245,
      "rangeRawSampleCount": 669,
      "rangeUsedSampleCount": 645,
      "safePercent": 0.7128678106540713,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.00290065264684,
      "selectionWilson95Low": 72.33335416003361,
      "walkForwardSampleCount": 135,
      "walkForwardHitRate": 81.48148148148148,
      "walkForwardWilson95Low": 74.09068999035055,
      "walkForwardWilson95High": 87.13021673447194,
      "walkForwardBlock95Low": 71.12676056338029,
      "walkForwardBlock95High": 90.29910929224843,
      "currentWindowSampleCount": 669,
      "currentWindowUsedCount": 644
    },
    "bear": {
      "rangeMeanPercent": 1.9610619145374437,
      "rangeRawSampleCount": 591,
      "rangeUsedSampleCount": 562,
      "safePercent": 0.8107954867607869,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.20035618878005,
      "selectionWilson95Low": 73.37235779835216,
      "walkForwardSampleCount": 118,
      "walkForwardHitRate": 77.11864406779661,
      "walkForwardWilson95Low": 68.75595657058834,
      "walkForwardWilson95High": 83.7713199570052,
      "walkForwardBlock95Low": 67.47919086333721,
      "walkForwardBlock95High": 86.40101694915253,
      "currentWindowSampleCount": 591,
      "currentWindowUsedCount": 565
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3611302638049063,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.50667729718955,
      "selectionWilson95Low": 73.28227181257671,
      "walkForwardSampleCount": 253,
      "walkForwardHitRate": 75.49407114624506,
      "walkForwardWilson95Low": 69.8387024726751,
      "walkForwardWilson95High": 80.38683377537173,
      "walkForwardBlock95Low": 70.39999999999999,
      "walkForwardBlock95High": 80.15873015873017,
      "currentWindowSampleCount": 1260,
      "currentWindowUsedCount": 1210
    },
    "down": {
      "safePercent": 0.3003297395469906,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.02491528802074,
      "selectionWilson95Low": 73.80827947749673,
      "walkForwardSampleCount": 253,
      "walkForwardHitRate": 73.91304347826086,
      "walkForwardWilson95Low": 68.17332345089257,
      "walkForwardWilson95High": 78.93745085929088,
      "walkForwardBlock95Low": 67.45075239398086,
      "walkForwardBlock95High": 80.078125,
      "currentWindowSampleCount": 1260,
      "currentWindowUsedCount": 1199
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 19.4%, 하락 25.3%로 안전선에 부적합"
  }
});
