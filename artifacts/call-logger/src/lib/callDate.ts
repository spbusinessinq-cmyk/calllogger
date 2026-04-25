import { type StoredCall } from "./types";

// Minimum plausible call timestamp — nothing before 2001 is a valid call log entry.
const MIN_YEAR = 2001;

function isPlausible(d: Date): boolean {
  return !isNaN(d.getTime()) && d.getFullYear() >= MIN_YEAR;
}

// ──────────────────────────────────────────────────────
// tryUnixOrString — core parser for any single raw value
//
// Returns null for: null/undefined/"", non-numeric garbage,
// dates before 2001 (catches "0", "1", small unix values, epoch strings).
// ──────────────────────────────────────────────────────

function tryUnixOrString(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!isNaN(n)) {
    // Unix milliseconds (13+ digits)
    if (n > 1_000_000_000_000) {
      const d = new Date(n);
      return isPlausible(d) ? d : null;
    }
    // Unix seconds (≥ 1_000_000_000 = Sept 2001+)
    if (n >= 1_000_000_000) {
      const d = new Date(n * 1000);
      return isPlausible(d) ? d : null;
    }
    // Small number — not a valid unix timestamp, fall through to string parse
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const s = value.trim();
    // Skip bare integers — they'd produce wrong dates via new Date(n)
    if (/^\d+$/.test(s)) return null;
    const d = new Date(s);
    return isPlausible(d) ? d : null;
  }
  return null;
}

// ──────────────────────────────────────────────────────
// getCallDate
//
// Probes every field name that may have appeared in older
// or differently-shaped stored call objects.  The function
// casts to Record<string,unknown> so it can safely read any
// field regardless of the current TypeScript StoredCall type.
// Never throws.  Always rejects dates before 2001.
// ──────────────────────────────────────────────────────
export function getCallDate(call: StoredCall): Date | null {
  const r = call as Record<string, unknown>;

  // ── ISO/timestamp string fields — startedAtISO is the primary source ──
  for (const field of ["startedAtISO", "startedAt", "timestamp"]) {
    const v = r[field];
    if (typeof v === "string" && v.length > 0) {
      const d = new Date(v);
      if (isPlausible(d)) return d;
    }
  }

  // ── Raw unix time fields — all possible field name variants ─────
  for (const field of [
    "rawTime", "raw_time",
    "microSipTime", "microsipTime",
    "timeUnix", "time_unix",
    "unixTime", "unix_time",
    "TimeUnix",
  ]) {
    const v = r[field];
    if (v !== undefined && v !== null && v !== "") {
      const d = tryUnixOrString(v);
      if (d) return d;
    }
  }

  // ── call.time / call.Time — may be unix seconds (classic MicroSIP CSV) ──
  for (const field of ["time", "Time"]) {
    const v = r[field];
    if (v !== undefined && v !== null) {
      const n = Number(v);
      if (!isNaN(n) && n >= 1_000_000_000) {
        const d = new Date(n * 1000);
        if (isPlausible(d)) return d;
      }
    }
  }

  // ── Date + Time string combinations ──────────────────────────────
  const dateFields = ["date", "Date", "dateKey"];
  const timeFields = ["time", "Time"];

  for (const df of dateFields) {
    const dv = r[df] as string | undefined;
    if (!dv || typeof dv !== "string") continue;
    const dateStr = dv.trim();
    // Skip if it looks like a unix timestamp or is empty
    if (!dateStr || /^\d{8,}$/.test(dateStr)) continue;

    // Try date + time combinations
    for (const tf of timeFields) {
      const tv = r[tf] as string | undefined;
      if (tv && typeof tv === "string") {
        const timeStr = tv.trim();
        // Skip unix-looking time values
        if (/^\d{8,}$/.test(timeStr)) continue;

        for (const sep of ["T", " "]) {
          const combined = `${dateStr}${sep}${timeStr}`;
          let d = new Date(combined);
          if (isPlausible(d)) return d;
          // Try with :00 appended for HH:MM format
          d = new Date(`${combined}:00`);
          if (isPlausible(d)) return d;
        }
      }
    }

    // Date alone — at least useful for day grouping (hour will be 0)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const d = new Date(`${dateStr}T00:00:00`);
      if (isPlausible(d)) return d;
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────
// Local YYYY-MM-DD using getFullYear / getMonth / getDate
// (never toISOString which is UTC)
// ──────────────────────────────────────────────────────
function localYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns local YYYY-MM-DD or "unknown" */
export function getDateKey(call: StoredCall): string {
  const d = getCallDate(call);
  return d ? localYMD(d) : "unknown";
}

/** Returns local 0-23 hour, or null if timestamp is missing or pre-2001 */
export function getHourKey(call: StoredCall): number | null {
  const d = getCallDate(call);
  return d ? d.getHours() : null;
}

// ──────────────────────────────────────────────────────
// repairTimestamps
//
// For every call: re-derive startedAtISO / dateKey / hourKey
// from whatever raw fields are available.  Safe to call
// multiple times — only modifies calls that actually change.
// Calls whose timestamps cannot be resolved to a plausible date
// are left unchanged (not stamped with epoch).
// ──────────────────────────────────────────────────────
export function repairTimestamps(calls: StoredCall[]): { calls: StoredCall[]; repairedCount: number } {
  let repairedCount = 0;
  const repaired = calls.map((c) => {
    const d = getCallDate(c);
    if (!d) return c; // can't resolve — leave unchanged, not epoch-stamped

    const startedAtISO = d.toISOString();
    const dateKey = localYMD(d);
    const hourKey = d.getHours();

    if (
      c.startedAtISO === startedAtISO &&
      c.dateKey === dateKey &&
      c.hourKey === hourKey
    ) return c;

    repairedCount++;
    return { ...c, startedAtISO, dateKey, hourKey };
  });
  return { calls: repaired, repairedCount };
}
