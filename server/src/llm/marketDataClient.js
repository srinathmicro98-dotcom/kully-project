// Free, keyless NSE market data via Yahoo Finance's public chart endpoint
// (".NS" suffix = NSE). No account/API key needed. This is real market
// data, not a mock — verified live against RELIANCE.NS before building this.
import { sma, rsi, macd } from '../../../shared/marketIndicators.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Wilder's smoothing and a 26-period EMA both need real warm-up history to
// converge close to what a broker's own chart would show — always fetch at
// least a year regardless of how many days the caller actually wants
// displayed, and only truncate for display after computing on the full set.
const RANGE_FOR_DAYS = (days) => (days > 365 ? '2y' : '1y');

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
