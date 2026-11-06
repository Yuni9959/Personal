// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-11-02",
  "effectiveThrough": "2026-11-08",
  "calculatedAt": "2026-11-07T08:30:20.487+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "6344bea9c8537ff17b13158577d40c202b32e1bca31dc5a0f08539b4d5b08bb1",
  "fitStart": "2021-11-02",
  "fitEndExclusive": "2026-11-02",
  "holdoutStart": "2025-11-03",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7657564749046943,
  "bearPercent": 1.9713002343101758,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7657564749046943,
      "rangeRawSampleCount": 669,
      "rangeUsedSampleCount": 645,
      "safePercent": 0.7152633069140468,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.03017241379311,
      "selectionWilson95Low": 72.36910385365192,
      "walkForwardSampleCount": 134,
      "walkForwardHitRate": 82.08955223880598,
      "walkForwardWilson95Low": 74.73197986028968,
      "walkForwardWilson95High": 87.65853801131081,
      "walkForwardBlock95Low": 72.5925925925926,
      "walkForwardBlock95High": 90.07633587786259,
      "currentWindowSampleCount": 669,
      "currentWindowUsedCount": 644
    },
    "bear": {
      "rangeMeanPercent": 1.9713002343101758,
      "rangeRawSampleCount": 592,
      "rangeUsedSampleCount": 563,
      "safePercent": 0.832636659879632,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.17667844522968,
      "selectionWilson95Low": 73.35559642047072,
      "walkForwardSampleCount": 120,
      "walkForwardHitRate": 80,
      "walkForwardWilson95Low": 71.96332649371804,
      "walkForwardWilson95High": 86.17552352115975,
      "walkForwardBlock95Low": 69.49152542372882,
      "walkForwardBlock95High": 89.34426229508196,
      "currentWindowSampleCount": 592,
      "currentWindowUsedCount": 566
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.35459590439514455,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.55048409405256,
      "selectionWilson95Low": 73.33213651936737,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 72.44094488188976,
      "walkForwardWilson95Low": 66.6426104411922,
      "walkForwardWilson95High": 77.57060512212685,
      "walkForwardBlock95Low": 67.05882352941175,
      "walkForwardBlock95High": 77.82101167315176,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1210
    },
    "down": {
      "safePercent": 0.3026674610114856,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.92590397154713,
      "selectionWilson95Low": 73.71315290397906,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 76.37795275590551,
      "walkForwardWilson95Low": 70.78549604673813,
      "walkForwardWilson95High": 81.18442400137373,
      "walkForwardBlock95Low": 70.03694960089817,
      "walkForwardBlock95High": 82.21343873517787,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1200
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 20.5%, 하락 27.2%로 안전선에 부적합"
  }
});
