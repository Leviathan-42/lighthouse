// Sparkline utility — the only thing left from the original mock data.
// UI synthesizes decorative sparklines (fleet summary strip, inspector traffic)
// until the API returns matching time series.

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function spark(seed: number, n = 32, base = 40, variance = 30): number[] {
  const r = seededRandom(seed);
  const out: number[] = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * variance * 0.3;
    v = Math.max(5, Math.min(95, v));
    out.push(v);
  }
  return out;
}
