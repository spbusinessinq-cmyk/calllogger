import { type StoredCall } from "./types";

// ──────────────────────────────────────────────────────
// tryUnixOrString — core parser for any single raw value
// ──────────────────────────────────────────────────────

function tryUnixOrString(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!isNaN(n)) {
    // Unix milliseconds (13+ digits, > year 2001 in ms)
    if (n > 1_000_000_000_000) return new Date(n);
    // Unix seconds (10 digits, > year 2001)
    if (n > 1_000_000_000) return new Date(n * 1000);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const d = new Date(value.trim());
    if (!isNaN(d.getTime())) return d;
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
// Never throws.
// ──────────────────────────────────────────────────────
export function getCallDate(call: StoredCall): Date | null {
  // Treat the stored call as a generic record so we can safely
  // probe all possible field names from older schema versions.
  const r = call as Record<string, unknown>;

  // ── ISO/timestamp string fields ──────────────────────
  for (const field of [
    "startedAtISO", "startedAt", "timestamp", "importedAt",
  ]) {
    const v = r[field];
    if (typeof v === "string" && v !== "") {
      // Only trust ISO-looking strings, not the importedAt fallback for time
      if (field === "importedAt") continue; // too recent, wrong time
      const d = new Date(v as string);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // ── Raw unix time fields — try all possible names ─────
  for (const field of [
    "rawTime", "raw_time",
    "microSipTime", "microsipTime",
    "timeUnix", "time_unix",
    "unixTime", "unix_time",
    "TimeUnix",
  ]) {
    const v = r[field];
    if (v !== undefined && v !== null) {
      const d = tryUnixOrString(v);
      if (d) return d;
    }
  }

  // ── call.time / call.Time — may be unix seconds (MicroSIP CSV) ──
  for (const field of ["time", "Time"]) {
    const v = r[field];
    if (v !== undefined) {
      const n = Number(v);
      if (!isNaN(n) && n > 1_000_000_000) return new Date(n * 1000);
    }
  }

  // ── Date+Time string combinations ─────────────────────
  const dateFields = ["date", "Date", "dateKey"];
  const timeFields = ["time", "Time"];

  for (const df of dateFields) {
    const dv = r[df] as string | undefined;
    if (!dv || typeof dv !== "string") continue;
    const dateStr = dv.trim();
    if (!dateStr || /^\d{9,}$/.test(dateStr)) continue; // skip unix-looking

    // date alone — at least useful for day chart
    for (const tf of timeFields) {
      const tv = r[tf] as string | undefined;
      if (tv && typeof tv === "string") {
        const timeStr = tv.trim();
        // Skip if time looks like a unix timestamp
        if (/^\d{9,}$/.test(timeStr)) continue;

        const combined = `${dateStr}T${timeStr}`;
        let d = new Date(combined);
        if (!isNaN(d.getTime())) return d;

        // Try appending :00 for HH:MM format
        d = new Date(`${combined}:00`);
        if (!isNaN(d.getTime())) return d;
      }
    }

    // date alone as last resort for day grouping (hour will be 0)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const d = new Date(dateStr + "T00:00:00");
      if (!isNaN(d.getTime())) return d;
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

/** Returns local 0-23 hour, or null if not resolvable */
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
// ──────────────────────────────────────────────────────
export function repairTimestamps(calls: StoredCall[]): { calls: StoredCall[]; repairedCount: number } {
  let repairedCount = 0;
  const repaired = calls.map((c) => {
    const d = getCallDate(c);
    if (!d) return c;

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
