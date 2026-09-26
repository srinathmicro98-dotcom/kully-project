// Single source of truth for technical-indicator math, used by BOTH
// server/src/llm/marketDataClient.js (imports this file directly — same
// repo, no build step needed) and lambda/control-plane/index.mjs (which
// can't import across the repo boundary since it's a separately-zipped
// deployment — lambda/deploy.sh copies this file into lambda/control-plane/
// before zipping, see that script).
//
// This split existed as two independently-hand-written copies before
// 2026-09-26 and drifted: the Lambda's RSI used a simplified "last N
// changes" average while this one used correct Wilder smoothing, giving
// materially different numbers (25.66 vs 37.40 on the same RELIANCE data).
// Never fork this file again — fix it here and redeploy both sides.

export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const series = [values.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < values.length; i++) {
    series.push(values[i] * k + series[series.length - 1] * (1 - k));
  }
  return series;
}

// Wilder's original smoothed RSI — recursive smoothing carried forward from
// the start of the series, which is what brokers/TradingView actually show.
export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

export function macd(values) {
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  if (!ema12.length || !ema26.length) return null;
  const offset = ema12.length - ema26.length;
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v);
  const signalSeries = emaSeries(macdLine, 9);
  if (!signalSeries.length) return null;
  return {
    macd: Math.round(macdLine[macdLine.length - 1] * 100) / 100,
    signal: Math.round(signalSeries[signalSeries.length - 1] * 100) / 100,
    histogram: Math.round((macdLine[macdLine.length - 1] - signalSeries[signalSeries.length - 1]) * 100) / 100,
  };
}
