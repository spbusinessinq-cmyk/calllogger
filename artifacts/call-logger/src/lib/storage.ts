import { type StoredCall, type ImportResult } from "./types";
import { normalizeStoredStatus, unixToDatetime } from "./parsers";
import { getCallDate, repairTimestamps } from "./callDate";

const CALLS_KEY = "ps_call_logger_calls";
const LAST_IMPORT_KEY = "ps_call_logger_last_import";
const LAST_MIGRATION_KEY = "ps_call_logger_last_migration";
const SCHEMA_VERSION_KEY = "ps_call_logger_schema_version";

// Bump this when the stored shape changes in a way that requires migration.
// v3: purge calls with no resolvable timestamp (epoch/pre-2001 artifacts from old parser).
export const DATA_SCHEMA_VERSION = 3;

// ──────────────────────────────────────────────
// Schema version
// ──────────────────────────────────────────────

export function loadSchemaVersion(): number {
  const v = localStorage.getItem(SCHEMA_VERSION_KEY);
  return v ? parseInt(v, 10) : 0;
}

export function saveSchemaVersion(v: number): void {
  localStorage.setItem(SCHEMA_VERSION_KEY, String(v));
}

// ──────────────────────────────────────────────
// Core CRUD
// ──────────────────────────────────────────────

export function loadCalls(): StoredCall[] {
  try {
    const raw = localStorage.getItem(CALLS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredCall[];
  } catch {
    return [];
  }
}

export function saveCalls(calls: StoredCall[]): void {
  localStorage.setItem(CALLS_KEY, JSON.stringify(calls));
}

export function clearCalls(): void {
  localStorage.removeItem(CALLS_KEY);
  localStorage.removeItem(LAST_IMPORT_KEY);
  localStorage.removeItem(LAST_MIGRATION_KEY);
  localStorage.removeItem(SCHEMA_VERSION_KEY);
}

export function loadLastImport(): ImportResult | null {
  try {
    const raw = localStorage.getItem(LAST_IMPORT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ImportResult;
  } catch {
    return null;
  }
}

export function saveLastImport(result: ImportResult): void {
  localStorage.setItem(LAST_IMPORT_KEY, JSON.stringify(result));
}

export function loadLastMigrationTime(): string | null {
  return localStorage.getItem(LAST_MIGRATION_KEY);
}

// ──────────────────────────────────────────────
// Schema repair — always runs on version mismatch
// ──────────────────────────────────────────────

export interface SchemaRepairResult {
  timestampRepaired: number;
  statusFixed: number;
  purgedCount: number;
  total: number;
  schemaVersion: number;
  ranAt: string;
}

/**
 * Run the full schema repair:
 * 1. Re-derive startedAtISO / dateKey / hourKey via getCallDate (handles all old field shapes).
 * 2. Re-normalize statuses from notes field.
 * 3. Save repaired calls back to localStorage.
 * 4. Stamp schema version.
 *
 * This is idempotent and safe to call multiple times.
 */
export function runSchemaRepair(): SchemaRepairResult {
  const raw = loadCalls();

  // Step 1 — timestamp repair via getCallDate (handles all raw field names)
  const { calls: tsRepaired, repairedCount: timestampRepaired } = repairTimestamps(raw);

  // Step 2 (v3) — purge calls with no resolvable timestamp.
  // These are broken artifacts from old parsers that produced epoch/pre-2001 dates.
  // Calls with a valid plausible date are kept.
  const beforePurge = tsRepaired.length;
  const afterPurge = tsRepaired.filter((c) => getCallDate(c) !== null);
  const purgedCount = beforePurge - afterPurge.length;

  // Step 3 — status normalization from notes
  let statusFixed = 0;
  const fullyRepaired = afterPurge.map((c) => {
    const correctedStatus = normalizeStoredStatus(c.status, c.notes);
    if (correctedStatus !== c.status) {
      statusFixed++;
      const keyParts = c.dedupeKey.split("|");
      keyParts[keyParts.length - 1] = correctedStatus.toLowerCase();
      return { ...c, status: correctedStatus, dedupeKey: keyParts.join("|") };
    }
    return c;
  });

  const ranAt = new Date().toISOString();
  saveCalls(fullyRepaired);
  localStorage.setItem(LAST_MIGRATION_KEY, ranAt);
  saveSchemaVersion(DATA_SCHEMA_VERSION);

  return {
    timestampRepaired,
    statusFixed,
    purgedCount,
    total: fullyRepaired.length,
    schemaVersion: DATA_SCHEMA_VERSION,
    ranAt,
  };
}

// ──────────────────────────────────────────────
// Combined migration (legacy alias used by dev tools)
// ──────────────────────────────────────────────

export interface MigrateResult {
  fixed: number;
  timestampFixed: number;
  before: Record<string, number>;
  after: Record<string, number>;
  timestampErrors: number;
  lastRun: string;
}

export function migrateAll(): MigrateResult {
  const calls = loadCalls();

  const before: Record<string, number> = {};
  calls.forEach((c) => { before[c.status] = (before[c.status] ?? 0) + 1; });

  const result = runSchemaRepair();
  const after_calls = loadCalls();

  const after: Record<string, number> = {};
  after_calls.forEach((c) => { after[c.status] = (after[c.status] ?? 0) + 1; });

  return {
    fixed: result.statusFixed,
    timestampFixed: result.timestampRepaired,
    before,
    after,
    timestampErrors: after_calls.filter((c) => !c.startedAtISO || c.startedAtISO === "").length,
    lastRun: result.ranAt,
  };
}

export function migrateNormalizeStatuses(): { fixed: number; before: Record<string, number>; after: Record<string, number> } {
  const r = migrateAll();
  return { fixed: r.fixed, before: r.before, after: r.after };
}

// ──────────────────────────────────────────────
// Import merge
// ──────────────────────────────────────────────

export function mergeImport(incoming: StoredCall[]): { imported: number; skipped: number } {
  const existing = loadCalls();
  const existingKeys = new Set(existing.map((c) => c.dedupeKey));

  const toAdd: StoredCall[] = [];
  let skipped = 0;

  for (const call of incoming) {
    if (existingKeys.has(call.dedupeKey)) {
      skipped++;
    } else {
      toAdd.push(call);
      existingKeys.add(call.dedupeKey);
    }
  }

  saveCalls([...existing, ...toAdd]);
  return { imported: toAdd.length, skipped };
}
