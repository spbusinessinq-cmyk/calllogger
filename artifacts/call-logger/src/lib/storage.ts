import { type StoredCall, type ImportResult } from "./types";
import { normalizeStoredStatus, unixToDatetime, makeDedupeKey, normalizePhone, normalizeName } from "./parsers";

const CALLS_KEY = "ps_call_logger_calls";
const LAST_IMPORT_KEY = "ps_call_logger_last_import";
const LAST_MIGRATION_KEY = "ps_call_logger_last_migration";

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
// Combined migration: statuses + timestamps
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

  let fixed = 0;
  let timestampFixed = 0;
  let timestampErrors = 0;

  const migrated = calls.map((c) => {
    let updated = { ...c };
    let changed = false;

    // 1. Re-normalize status from notes
    const correctedStatus = normalizeStoredStatus(c.status, c.notes);
    if (correctedStatus !== c.status) {
      updated.status = correctedStatus;
      fixed++;
      changed = true;
    }

    // 2. Backfill canonical timestamp fields if missing
    const needsTimestamp = !updated.dateKey || updated.dateKey === "";
    if (needsTimestamp) {
      // Try rawTime (unix seconds) first
      if (updated.rawTime && /^\d+$/.test(updated.rawTime.trim())) {
        const ts = unixToDatetime(updated.rawTime);
        if (ts.dateKey) {
          updated.startedAtISO = ts.startedAtISO;
          updated.dateKey = ts.dateKey;
          updated.hourKey = ts.hourKey;
          updated.date = ts.date;
          updated.time = ts.time;
          updated.hour = ts.hourKey;
          timestampFixed++;
          changed = true;
        } else {
          timestampErrors++;
        }
      } else if (updated.date) {
        // Fallback: derive from existing date/time/hour strings
        updated.dateKey = updated.date.trim().slice(0, 10); // YYYY-MM-DD slice
        updated.hourKey = updated.hour ?? (updated.time ? parseInt(updated.time.split(":")[0], 10) : 0);
        if (!updated.startedAtISO) {
          // Try to construct ISO from date + time
          try {
            const d = new Date(`${updated.dateKey}T${updated.time || "00:00"}:00`);
            if (!isNaN(d.getTime())) updated.startedAtISO = d.toISOString();
          } catch { /* ignore */ }
        }
        timestampFixed++;
        changed = true;
      } else {
        timestampErrors++;
      }
    }

    // 3. Rebuild dedupeKey if status changed (last pipe-segment)
    if (changed && correctedStatus !== c.status) {
      const keyParts = updated.dedupeKey.split("|");
      keyParts[keyParts.length - 1] = updated.status.toLowerCase();
      updated.dedupeKey = keyParts.join("|");
    }

    return updated;
  });

  const after: Record<string, number> = {};
  migrated.forEach((c) => { after[c.status] = (after[c.status] ?? 0) + 1; });

  const lastRun = new Date().toISOString();
  saveCalls(migrated);
  localStorage.setItem(LAST_MIGRATION_KEY, lastRun);

  return { fixed, timestampFixed, before, after, timestampErrors, lastRun };
}

// Legacy compat — now calls migrateAll
export function migrateNormalizeStatuses(): { fixed: number; before: Record<string, number>; after: Record<string, number> } {
  const result = migrateAll();
  return { fixed: result.fixed, before: result.before, after: result.after };
}

export function mergeImport(
  incoming: StoredCall[]
): { imported: number; skipped: number } {
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
