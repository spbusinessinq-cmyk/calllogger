import { type StoredCall } from "./types";

/**
 * Canonical date resolution for a stored call.
 *
 * Tries fields in priority order:
 * 1. startedAtISO    — ISO string already stored
 * 2. rawTime         — if numeric and > 1_000_000_000 → unix seconds (MicroSIP)
 * 3. time            — same unix-seconds test (MicroSIP CSV "Time" field)
 * 4. date + " " + time  — wall-clock string combo
 * 5. dateKey + " " + time
 *
 * Returns null when nothing resolvable is found.
 */
export function getCallDate(call: StoredCall): Date | null {
  // 1. startedAtISO
  if (call.startedAtISO && call.startedAtISO !== "") {
    const d = new Date(call.startedAtISO);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. rawTime — unix seconds (MicroSIP "Time" column)
  if (call.rawTime) {
    const n = Number(call.rawTime);
    if (!isNaN(n) && n > 1_000_000_000) {
      return new Date(n * 1000);
    }
  }

  // 3. call.time — if it looks like unix seconds
  if (call.time) {
    const n = Number(call.time);
    if (!isNaN(n) && n > 1_000_000_000) {
      return new Date(n * 1000);
    }
  }

  // 4. date + time wall-clock string
  if (call.date && call.time && !/^\d{9,}$/.test(call.time)) {
    const combined = `${call.date.trim()}T${call.time.trim()}`;
    const d = new Date(combined);
    if (!isNaN(d.getTime())) return d;

    // Try with seconds appended if HH:MM only
    const withSec = `${call.date.trim()}T${call.time.trim()}:00`;
    const d2 = new Date(withSec);
    if (!isNaN(d2.getTime())) return d2;
  }

  // 5. dateKey + time
  if (call.dateKey && call.dateKey !== "" && call.time && !/^\d{9,}$/.test(call.time)) {
    const combined = `${call.dateKey.trim()}T${call.time.trim()}`;
    const d = new Date(combined);
    if (!isNaN(d.getTime())) return d;

    const withSec = `${call.dateKey.trim()}T${call.time.trim()}:00`;
    const d2 = new Date(withSec);
    if (!isNaN(d2.getTime())) return d2;
  }

  // 6. date alone — midnight, still useful for day chart
  if (call.date && /^\d{4}-\d{2}-\d{2}$/.test(call.date.trim())) {
    const d = new Date(call.date.trim() + "T00:00:00");
    if (!isNaN(d.getTime())) return d;
  }

  if (call.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(call.dateKey.trim())) {
    const d = new Date(call.dateKey.trim() + "T00:00:00");
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/** Returns local YYYY-MM-DD or "unknown" */
export function getDateKey(call: StoredCall): string {
  const d = getCallDate(call);
  if (!d) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns local 0-23 hour, or null if no resolvable timestamp */
export function getHourKey(call: StoredCall): number | null {
  // If we already have unix seconds from rawTime we can derive exact hour
  const d = getCallDate(call);
  if (!d) return null;
  return d.getHours();
}

/**
 * One-time repair migration:
 * For every stored call, re-derive startedAtISO / dateKey / hourKey
 * using getCallDate and write back to localStorage.
 * Safe to call on startup — idempotent.
 */
export function repairTimestamps(calls: StoredCall[]): StoredCall[] {
  return calls.map((c) => {
    const d = getCallDate(c);
    if (!d) return c;

    const startedAtISO = d.toISOString();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const dateKey = `${y}-${mo}-${day}`;
    const hourKey = d.getHours();

    // Only write if something actually changed
    if (
      c.startedAtISO === startedAtISO &&
      c.dateKey === dateKey &&
      c.hourKey === hourKey
    ) return c;

    return { ...c, startedAtISO, dateKey, hourKey };
  });
}
