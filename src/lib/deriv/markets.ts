export type MarketSymbol =
  | "R_10" | "R_25" | "R_50" | "R_75" | "R_100"
  | "1HZ10V" | "1HZ25V" | "1HZ50V" | "1HZ75V" | "1HZ100V"
  | "BOOM1000" | "BOOM500" | "CRASH1000" | "CRASH500";

export interface Market {
  symbol: MarketSymbol;
  name: string;
  group: "Volatility" | "Volatility 1s" | "Boom" | "Crash";
}

export const MARKETS: Market[] = [
  { symbol: "R_10",  name: "Volatility 10 Index",  group: "Volatility" },
  { symbol: "R_25",  name: "Volatility 25 Index",  group: "Volatility" },
  { symbol: "R_50",  name: "Volatility 50 Index",  group: "Volatility" },
  { symbol: "R_75",  name: "Volatility 75 Index",  group: "Volatility" },
  { symbol: "R_100", name: "Volatility 100 Index", group: "Volatility" },
  { symbol: "1HZ10V",  name: "Volatility 10 (1s)",  group: "Volatility 1s" },
  { symbol: "1HZ25V",  name: "Volatility 25 (1s)",  group: "Volatility 1s" },
  { symbol: "1HZ50V",  name: "Volatility 50 (1s)",  group: "Volatility 1s" },
  { symbol: "1HZ75V",  name: "Volatility 75 (1s)",  group: "Volatility 1s" },
  { symbol: "1HZ100V", name: "Volatility 100 (1s)", group: "Volatility 1s" },
  { symbol: "BOOM500",   name: "Boom 500 Index",   group: "Boom" },
  { symbol: "BOOM1000",  name: "Boom 1000 Index",  group: "Boom" },
  { symbol: "CRASH500",  name: "Crash 500 Index",  group: "Crash" },
  { symbol: "CRASH1000", name: "Crash 1000 Index", group: "Crash" },
];

export const DERIV_APP_ID = "1089"; // public demo app id
export const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;
