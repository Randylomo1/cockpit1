/**
 * IndexedDB tick history store — continuous digit capture for backtesting.
 *
 * Strategy:
 *  - Writes are batched in-memory and flushed every FLUSH_MS to avoid
 *    hammering IDB on every tick.
 *  - Per-market cap (TICKS_PER_MARKET_CAP). Oldest entries are pruned on
 *    flush so the store never grows unbounded.
 *  - Targets the spec: 10k minimum, 50k preferred, 100k ideal across markets.
 */

export interface TickRow {
  id?: number;
  ts: number;       // ms epoch
  symbol: string;
  price: number;
  digit: number;
}

const DB_NAME = "mx-ticks-v1";
const STORE = "ticks";
const FLUSH_MS = 2000;
export const TICKS_PER_MARKET_CAP = 20_000; // 5 markets × 20k = 100k ideal

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        s.createIndex("ts", "ts");
        s.createIndex("symbol", "symbol");
        s.createIndex("symbol_ts", ["symbol", "ts"]);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// ─── batched writer ─────────────────────────────────────────────────────
const queue: TickRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const perMarketCounts: Record<string, number> = {};
let countsHydrated = false;

async function hydrateCounts() {
  if (countsHydrated) return;
  countsHydrated = true;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const idx = tx.objectStore(STORE).index("symbol");
      const req = idx.openKeyCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const sym = cur.key as string;
        perMarketCounts[sym] = (perMarketCounts[sym] ?? 0) + 1;
        cur.continue();
      };
      req.onerror = () => resolve();
    });
  } catch {/* ignore */}
}

export function recordTick(row: TickRow) {
  queue.push(row);
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

async function flush() {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await hydrateCounts();
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const r of batch) {
        store.add(r);
        perMarketCounts[r.symbol] = (perMarketCounts[r.symbol] ?? 0) + 1;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Prune any market exceeding cap.
    const overflowing = Object.entries(perMarketCounts).filter(([, n]) => n > TICKS_PER_MARKET_CAP);
    for (const [sym, n] of overflowing) {
      await pruneOldest(sym, n - TICKS_PER_MARKET_CAP);
    }
  } catch {/* swallow — ticks are best-effort */}
}

async function pruneOldest(symbol: string, count: number) {
  if (count <= 0) return;
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const idx = tx.objectStore(STORE).index("symbol_ts");
    const range = IDBKeyRange.bound([symbol, -Infinity], [symbol, Infinity]);
    const req = idx.openCursor(range, "next");
    let removed = 0;
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || removed >= count) return resolve();
      cur.delete();
      removed++;
      perMarketCounts[symbol] = Math.max(0, (perMarketCounts[symbol] ?? 0) - 1);
      cur.continue();
    };
    req.onerror = () => resolve();
  });
}

// ─── readers ────────────────────────────────────────────────────────────
export async function loadTickDigits(symbol: string, limit = 5000): Promise<number[]> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("symbol_ts");
    const range = IDBKeyRange.bound([symbol, -Infinity], [symbol, Infinity]);
    const out: number[] = [];
    // newest-first then reverse to chronological
    const req = idx.openCursor(range, "prev");
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= limit) {
        resolve(out.reverse());
        return;
      }
      out.push((cur.value as TickRow).digit);
      cur.continue();
    };
    req.onerror = () => resolve([]);
  });
}

export async function tickCounts(): Promise<Record<string, number>> {
  await hydrateCounts();
  return { ...perMarketCounts };
}

export async function clearTicks(symbol?: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (!symbol) {
      const r = store.clear();
      r.onsuccess = () => { for (const k of Object.keys(perMarketCounts)) delete perMarketCounts[k]; resolve(); };
      r.onerror = () => resolve();
      return;
    }
    const idx = store.index("symbol");
    const r = idx.openCursor(IDBKeyRange.only(symbol));
    r.onsuccess = () => {
      const cur = r.result;
      if (!cur) { perMarketCounts[symbol] = 0; return resolve(); }
      cur.delete();
      cur.continue();
    };
    r.onerror = () => resolve();
  });
}
