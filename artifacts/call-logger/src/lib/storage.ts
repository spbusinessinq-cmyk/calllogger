import { type StoredCall, type ImportResult } from "./types";

const CALLS_KEY = "ps_call_logger_calls";
const LAST_IMPORT_KEY = "ps_call_logger_last_import";

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
