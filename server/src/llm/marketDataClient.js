// Free, keyless NSE market data via Yahoo Finance's public chart endpoint
// (".NS" suffix = NSE). No account/API key needed. This is real market
// data, not a mock — verified live against RELIANCE.NS before building this.
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const series = [values.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < values.length; i++) {
    series.push(values[i] * k + series[series.length - 1] * (1 - k));
  }
  return series;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(values) {
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

const RANGE_FOR_DAYS = (days) => (days <= 7 ? '1mo' : days <= 90 ? '6mo' : days <= 200 ? '1y' : '2y');

/**
 * Real NSE price history + computed technical indicators for one symbol.
 * `symbol` is the plain NSE ticker (e.g. "RELIANCE", "TCS") — the .NS
 * exchange suffix is added here.
 */
export async function getHistoricalWithIndicators(symbol, days = 90) {
  const ticker = symbol.toUpperCase().replace(/\.NS$/i, '');
  const range = RANGE_FOR_DAYS(days);
  const res = await fetch(`${BASE}/${encodeURIComponent(ticker)}.NS?range=${range}&interval=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) return { error: `market data lookup failed: ${res.status} (check the symbol is a valid NSE ticker)` };

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) return { error: data.chart?.error?.description || 'no data returned for this symbol' };

  const timestamps = result.timestamp ?? [];
  const closes = (result.indicators.quote[0].close ?? []).filter((v) => v != null);
  if (closes.length < 15) return { error: 'not enough price history returned to compute indicators' };

  const recentDays = Math.min(days, closes.length);
  const recentCloses = closes.slice(-recentDays);
  const recentDates = timestamps.slice(-recentDays).map((t) => new Date(t * 1000).toISOString().slice(0, 10));

  return {
    symbol: ticker,
    currency: result.meta.currency,
    latestPrice: result.meta.regularMarketPrice,
    fiftyTwoWeekHigh: result.meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: result.meta.fiftyTwoWeekLow,
    priceHistory: recentDates.map((date, i) => ({ date, close: Math.round(recentCloses[i] * 100) / 100 })),
    indicators: {
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      rsi14: rsi(closes, 14),
      macd: macd(closes),
    },
  };
}
