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
  "calculatedAt": "2026-11-21T20:30:18.523+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "5b59ee9c90be2eb459439c929d7916555ee873ae6dba28345e356140406a99b9",
  "fitStart": "2021-11-16",
  "fitEndExclusive": "2026-11-16",
  "holdoutStart": "2025-11-17",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7787968698957632,
  "bearPercent": 1.9900492241801597,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7787968698957632,
      "rangeRawSampleCount": 668,
      "rangeUsedSampleCount": 642,
      "safePercent": 0.7230984219422399,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.05812701829925,
      "selectionWilson95Low": 72.39849907877127,
      "walkForwardSampleCount": 137,
      "walkForwardHitRate": 82.48175182481752,
      "walkForwardWilson95Low": 75.25581028028645,
      "walkForwardWilson95High": 87.93581010281841,
      "walkForwardBlock95Low": 73.13355635615028,
      "walkForwardBlock95High": 90.51195471004078,
      "currentWindowSampleCount": 668,
      "currentWindowUsedCount": 642
    },
    "bear": {
      "rangeMeanPercent": 1.9900492241801597,
      "rangeRawSampleCount": 593,
      "rangeUsedSampleCount": 566,
      "safePercent": 0.8361753140963846,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.20915896081021,
      "selectionWilson95Low": 73.3916702726311,
      "walkForwardSampleCount": 117,
      "walkForwardHitRate": 80.34188034188034,
      "walkForwardWilson95Low": 72.22629728068515,
      "walkForwardWilson95High": 86.52837242696097,
      "walkForwardBlock95Low": 69.82758620689656,
      "walkForwardBlock95High": 89.91596638655463,
      "currentWindowSampleCount": 593,
      "currentWindowUsedCount": 568
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3536971537564119,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.5217905738513,
      "selectionWilson95Low": 73.30424008990711,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 73.22834645669292,
      "walkForwardWilson95Low": 67.46679149008862,
      "walkForwardWilson95High": 78.297764970189,
      "walkForwardBlock95Low": 67.98418972332016,
      "walkForwardBlock95High": 78.515625,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1209
    },
    "down": {
      "safePercent": 0.3105096083857857,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.9359100769079,
      "selectionWilson95Low": 73.72452402053601,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 76.77165354330708,
      "walkForwardWilson95Low": 71.20294825531228,
      "walkForwardWilson95High": 81.54264224127886,
      "walkForwardBlock95Low": 70.11850236847884,
      "walkForwardBlock95High": 82.74509803921568,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1203
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 21.7%, 하락 27.2%로 안전선에 부적합"
  }
});
