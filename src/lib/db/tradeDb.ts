/**
 * IndexedDB trade log. Stores every executed trade with full context so we
 * can post-mortem signal quality, latency, win-rate by digit / market / mode.
 *
 * Demo and Real are tagged with `mode` so analytics can be filtered. They are
 * never mixed in computed stats.
 */

export type TradeMode = "DEMO" | "REAL";
export type TradeOutcome = "OPEN" | "WIN" | "LOSS" | "ERROR";

export interface TradeRow {
  id?: number;
  ts: number;             // ms epoch of buy confirmation
  mode: TradeMode;
  loginid?: string;
  symbol: string;
  digit: number;
  stake: number;
  payout?: number;
  contractId?: number;
  signalScore?: number;
  signalStrength?: string;
  dominanceGap?: number;
  tickReceivedAt?: number;
  signalAt?: number;
  proposalMs?: number;
  buyMs?: number;
  totalMs?: number;
  signalToOrderMs?: number;
  outcome: TradeOutcome;
  profit?: number;
  error?: string;
}

const DB_NAME = "mx-cockpit-v1";
const STORE = "trades";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        s.createIndex("ts", "ts");
        s.createIndex("mode", "mode");
        s.createIndex("symbol", "symbol");
        s.createIndex("contractId", "contractId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function insertTrade(row: TradeRow): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add(row);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

export async function updateTradeOutcome(
  id: number,
  patch: Partial<Pick<TradeRow, "outcome" | "profit" | "error">>,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const row = getReq.result;
      if (!row) return resolve();
      const merged = { ...row, ...patch };
      const putReq = store.put(merged);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function listTrades(opts: { mode?: TradeMode; limit?: number } = {}): Promise<TradeRow[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("ts");
    const out: TradeRow[] = [];
    const limit = opts.limit ?? 500;
    const req = idx.openCursor(null, "prev");
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= limit) return resolve(out);
      const row = cur.value as TradeRow;
      if (!opts.mode || row.mode === opts.mode) out.push(row);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearTrades(mode?: TradeMode): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (!mode) {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      return;
    }
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      if ((cur.value as TradeRow).mode === mode) cur.delete();
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  open: number;
  netPnL: number;
  winRate: number;
  avgTotalMs: number;
  avgSignalToOrderMs: number;
}

export function summarise(rows: TradeRow[]): TradeStats {
  let wins = 0, losses = 0, open = 0, net = 0, totMs = 0, totN = 0, s2o = 0, s2oN = 0;
  for (const r of rows) {
    if (r.outcome === "WIN") wins++;
    else if (r.outcome === "LOSS") losses++;
    else if (r.outcome === "OPEN") open++;
    if (typeof r.profit === "number") net += r.profit;
    if (typeof r.totalMs === "number") { totMs += r.totalMs; totN++; }
    if (typeof r.signalToOrderMs === "number") { s2o += r.signalToOrderMs; s2oN++; }
  }
  const settled = wins + losses;
  return {
    trades: rows.length,
    wins, losses, open,
    netPnL: net,
    winRate: settled > 0 ? (wins / settled) * 100 : 0,
    avgTotalMs: totN ? Math.round(totMs / totN) : 0,
    avgSignalToOrderMs: s2oN ? Math.round(s2o / s2oN) : 0,
  };
}
