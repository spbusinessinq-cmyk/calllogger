import Papa from "papaparse";
import { type StoredCall, type ParsedRow, type CallSource, type CallStatus } from "./types";
import { maskPhone, formatDuration } from "./utils";

// ──────────────────────────────────────────────
// Normalization helpers
// ──────────────────────────────────────────────

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").trim();
}

export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeStatus(raw: string): CallStatus {
  const s = raw.trim().toLowerCase();
  if (s === "answered" || s === "in") return "Answered";
  if (s === "answered elsewhere") return "Answered";
  if (s === "call ended" || s === "ended") return "Call Ended";
  if (s === "missed" || s === "miss") return "Missed";
  if (s === "declined") return "Missed";
  if (s === "canceled" || s === "cancelled") return "Canceled";
  if (s === "voicemail" || s === "voice mail") return "Voicemail";
  if (s === "busy" || s === "no answer") return "Missed";
  if (s === "out" || s === "outgoing") return "Outgoing";
  if (s === "0") return "Outgoing";
  if (s === "1") return "Answered";
  if (s === "2") return "Missed";
  if (s === "3") return "Other";
  return "Other";
}

export function normalizeStoredStatus(currentStatus: CallStatus, notes: string): CallStatus {
  const n = notes.trim().toLowerCase();
  if (n.includes("answered elsewhere")) return "Answered";
  if (n.includes("call ended")) return "Call Ended";
  if (n.includes("cancelled") || n.includes("canceled")) return "Canceled";
  if (n.includes("declined")) return "Missed";
  if (n.includes("busy")) return "Missed";
  if (n.includes("no answer")) return "Missed";
  if (n.includes("voicemail") || n.includes("voice mail")) return "Voicemail";
  return currentStatus;
}

export function resolveMicroSIPStatus(info: string, typeRaw: string): CallStatus {
  const i = info.trim().toLowerCase();
  if (i.includes("answered elsewhere")) return "Answered";
  if (i.includes("call ended")) return "Call Ended";
  if (i.includes("cancelled") || i.includes("canceled")) return "Canceled";
  if (i.includes("declined")) return "Missed";
  if (i.includes("busy")) return "Missed";
  if (i.includes("no answer")) return "Missed";
  if (i.includes("voicemail") || i.includes("voice mail")) return "Voicemail";

  const t = typeRaw.trim().toLowerCase();
  if (t === "in" || t === "incoming" || t === "answered") return "Answered";
  if (t === "out" || t === "outgoing") return "Outgoing";
  if (t === "miss" || t === "missed") return "Missed";
  if (t === "canceled" || t === "cancelled") return "Canceled";
  if (t === "voicemail") return "Voicemail";
  if (t === "0") return "Outgoing";
  if (t === "1") return "Answered";
  if (t === "2") return "Missed";
  if (t === "3") return "Other";
  return "Other";
}

function parseDurationToSeconds(raw: string): number {
  if (!raw) return 0;
  raw = raw.trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  let total = 0;
  const hMatch = raw.match(/(\d+)h/);
  const mMatch = raw.match(/(\d+)m/);
  const sMatch = raw.match(/(\d+)s/);
  if (hMatch) total += parseInt(hMatch[1]) * 3600;
  if (mMatch) total += parseInt(mMatch[1]) * 60;
  if (sMatch) total += parseInt(sMatch[1]);
  if (!hMatch && !mMatch && !sMatch) {
    // Try HH:MM:SS
    const colonParts = raw.split(":");
    if (colonParts.length === 3) {
      const [h, m, s] = colonParts.map(Number);
      if (!isNaN(h) && !isNaN(m) && !isNaN(s)) return h * 3600 + m * 60 + s;
    }
    if (colonParts.length === 2) {
      const [m, s] = colonParts.map(Number);
      if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
    }
  }
  return total;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Convert Unix timestamp (seconds) to canonical fields using LOCAL time.
// Requires ts >= 1_000_000_000 (Jan 2001+) to prevent garbage from small integers.
export function unixToDatetime(unix: string | number): {
  date: string; time: string; hour: number;
  startedAtISO: string; dateKey: string; hourKey: number;
} {
  const ts = typeof unix === "string" ? parseInt(unix, 10) : unix;
  // Must be a plausible unix timestamp (≥ 2001-09-08)
  if (isNaN(ts) || ts < 1_000_000_000) {
    return { date: "", time: "", hour: 0, startedAtISO: "", dateKey: "", hourKey: 0 };
  }
  const d = new Date(ts * 1000);
  const dateKey = localDateKey(d);
  const time = localTimeStr(d);
  const hourKey = d.getHours();
  return { date: dateKey, time, hour: hourKey, startedAtISO: d.toISOString(), dateKey, hourKey };
}

// Robust date+time string parsing. Handles many real-world formats.
export function parseDatetime(dateRaw: string, timeRaw: string): {
  date: string; time: string; hour: number;
  startedAtISO: string; dateKey: string; hourKey: number;
} {
  const dateStr = (dateRaw ?? "").trim();
  const timeStr = (timeRaw ?? "").trim();

  function normalizeDate(s: string): string {
    const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // "Apr 25 2026" or "April 25, 2026" etc.
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return localDateKey(d);
    } catch { /* ignore */ }
    return s;
  }

  function normalizeTime(s: string): string {
    // 12-hour: "9:30 AM", "09:30:00 PM"
    const ampm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const min = ampm[2];
      const meridiem = ampm[4].toUpperCase();
      if (meridiem === "AM" && h === 12) h = 0;
      if (meridiem === "PM" && h !== 12) h += 12;
      return `${String(h).padStart(2, "0")}:${min}`;
    }
    // Already HH:MM or HH:MM:SS
    if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
    return s;
  }

  const normalDate = normalizeDate(dateStr);
  const normalTime = normalizeTime(timeStr);

  if (normalDate && normalTime) {
    const combined = `${normalDate}T${normalTime}`;
    const d = new Date(combined);
    if (!isNaN(d.getTime())) {
      return {
        date: localDateKey(d), time: localTimeStr(d), hour: d.getHours(),
        startedAtISO: d.toISOString(), dateKey: localDateKey(d), hourKey: d.getHours(),
      };
    }
    // Try appending :00 for HH:MM
    const d2 = new Date(`${combined}:00`);
    if (!isNaN(d2.getTime())) {
      return {
        date: localDateKey(d2), time: localTimeStr(d2), hour: d2.getHours(),
        startedAtISO: d2.toISOString(), dateKey: localDateKey(d2), hourKey: d2.getHours(),
      };
    }
  }

  if (normalDate) {
    // date-only — use it for day grouping, parse time separately
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalDate)) {
      const hour = normalTime ? parseInt(normalTime.split(":")[0], 10) : 0;
      const safeHour = isNaN(hour) ? 0 : hour;
      // Construct a proper ISO if we have a time
      if (normalTime && /^\d{2}:\d{2}/.test(normalTime)) {
        const d = new Date(`${normalDate}T${normalTime}`);
        if (!isNaN(d.getTime())) {
          return {
            date: localDateKey(d), time: localTimeStr(d), hour: d.getHours(),
            startedAtISO: d.toISOString(), dateKey: localDateKey(d), hourKey: d.getHours(),
          };
        }
      }
      // date with no usable time
      const d = new Date(`${normalDate}T${String(safeHour).padStart(2,"0")}:00:00`);
      if (!isNaN(d.getTime())) {
        return {
          date: localDateKey(d), time: normalTime || "",
          hour: safeHour, startedAtISO: safeHour > 0 ? d.toISOString() : "",
          dateKey: localDateKey(d), hourKey: safeHour,
        };
      }
    }
  }

  // Last fallback: try parsing the whole dateStr as an ISO-like string
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      return {
        date: localDateKey(d), time: localTimeStr(d), hour: d.getHours(),
        startedAtISO: d.toISOString(), dateKey: localDateKey(d), hourKey: d.getHours(),
      };
    }
  }

  const hour = normalTime ? parseInt(normalTime.split(":")[0], 10) : 0;
  return { date: dateStr, time: timeStr, hour: isNaN(hour) ? 0 : hour, startedAtISO: "", dateKey: "", hourKey: isNaN(hour) ? 0 : hour };
}

// ──────────────────────────────────────────────
// DedupeKey
// ──────────────────────────────────────────────

export function makeDedupeKey(row: {
  phoneNumber: string;
  callerName: string;
  date: string;
  time: string;
  durationSeconds: number;
  status: string;
}): string {
  const phone = normalizePhone(row.phoneNumber);
  const name = normalizeName(row.callerName);
  const dt = `${row.date.trim()}T${row.time.trim()}`;
  return `${phone}|${name}|${dt}|${row.durationSeconds}|${row.status.toLowerCase()}`;
}

// ──────────────────────────────────────────────
// Convert ParsedRow → StoredCall
// ──────────────────────────────────────────────

export function toStoredCall(row: ParsedRow, source: CallSource): StoredCall {
  const phone = normalizePhone(row.phoneNumber);
  const dedupeKey = makeDedupeKey({ ...row, phoneNumber: phone });
  return {
    callerName: row.callerName.trim() || "Unknown",
    phoneNumber: phone,
    maskedNumber: maskPhone(phone),
    date: row.date,
    time: row.time,
    hour: row.hourKey ?? (row.time ? parseInt(row.time.split(":")[0], 10) : 0),
    durationSeconds: row.durationSeconds,
    duration: formatDuration(row.durationSeconds),
    status: row.status,
    notes: row.notes.trim(),
    source,
    dedupeKey,
    importedAt: new Date().toISOString(),
    startedAtISO: row.startedAtISO ?? "",
    dateKey: row.dateKey || row.date,
    hourKey: row.hourKey ?? (row.time ? parseInt(row.time.split(":")[0], 10) : 0),
    rawTime: row.rawTime,
  };
}

// ──────────────────────────────────────────────
// Format Detection
// ──────────────────────────────────────────────

export type DetectedFormat =
  | "microsip-xml"
  | "microsip-ini"
  | "microsip-csv"
  | "standard-csv"
  | "callcentric-csv"
  | "unknown";

export function detectFormat(text: string): DetectedFormat {
  const trimmed = text.trim();
  if (trimmed.startsWith("<") && (trimmed.includes("<calls") || trimmed.includes("<call"))) {
    return "microsip-xml";
  }
  if (trimmed.startsWith("[Calls]") || trimmed.startsWith("[Settings]") ||
    /^\d+=\S+;/.test(trimmed.split("\n").find(l => /^\d+=/.test(l.trim())) ?? "")) {
    return "microsip-ini";
  }
  const firstLine = trimmed.split("\n")[0].toLowerCase().replace(/\s+/g, "");
  // MicroSIP CSV: starts with type or direction column + name + number
  if (
    firstLine.startsWith("type,name,number") ||
    firstLine.startsWith("type,number,name") ||
    firstLine.startsWith("direction,name,number") ||
    firstLine.startsWith("direction,number,name") ||
    // Broader: has "type" or "direction" + "name" + "number" in the header
    (firstLine.includes("type") && firstLine.includes("name") && firstLine.includes("number")) ||
    (firstLine.includes("direction") && firstLine.includes("name") && firstLine.includes("number"))
  ) {
    return "microsip-csv";
  }
  if (firstLine.includes("direction") || firstLine.includes("callerid") || firstLine.includes("callerid")) {
    return "callcentric-csv";
  }
  if (firstLine.includes("name") && firstLine.includes("number") &&
    (firstLine.includes("date") || firstLine.includes("time"))) {
    return "standard-csv";
  }
  if (trimmed.includes(",")) {
    return "standard-csv";
  }
  return "unknown";
}

export const FORMAT_LABELS: Record<DetectedFormat, string> = {
  "microsip-xml": "MicroSIP XML",
  "microsip-ini": "MicroSIP INI",
  "microsip-csv": "MicroSIP CSV",
  "standard-csv": "Standard CSV",
  "callcentric-csv": "Callcentric CSV",
  "unknown": "Unknown",
};

// ──────────────────────────────────────────────
// ParseResult with import debug info
// ──────────────────────────────────────────────

export interface ImportDebug {
  importedCount: number;
  skippedCount: number;        // rows skipped due to invalid timestamp
  invalidTimestampCount: number;
  earliestCall: string | null; // ISO string
  latestCall: string | null;   // ISO string
  busiestHours: Array<{ hour: number; label: string; count: number }>;
  detectedColumns: string[];   // column names found
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: string[];
  format: DetectedFormat;
  debug?: ImportDebug;
}

export function parseText(text: string): ParseResult {
  const format = detectFormat(text);
  switch (format) {
    case "microsip-xml": return parseMicroSIPXML(text);
    case "microsip-ini": return parseMicroSIPINI(text);
    case "microsip-csv": return parseMicroSIPCSV(text);
    case "callcentric-csv": return parseCallcentricCSV(text);
    case "standard-csv": return parseStandardCSV(text);
    default:
      return { rows: [], errors: ["Could not detect call-log format. Expected columns: Name,Number,Date,Time,Duration,Status,Notes or MicroSIP format with Type/Direction,Name,Number,Time,Duration,Info"], format };
  }
}

// ──────────────────────────────────────────────
// Fuzzy column finder helper
// ──────────────────────────────────────────────

function makeFinder(keys: string[]) {
  return (candidates: string[]): string | undefined =>
    keys.find((k) => candidates.some((c) => k.trim().toLowerCase() === c.trim().toLowerCase())) ??
    keys.find((k) => candidates.some((c) => k.trim().toLowerCase().includes(c.trim().toLowerCase())));
}

// ──────────────────────────────────────────────
// Build ImportDebug from parsed rows
// ──────────────────────────────────────────────

function buildDebug(rows: ParsedRow[], skippedCount: number, detectedColumns: string[]): ImportDebug {
  const validRows = rows.filter((r) => r.startedAtISO && r.startedAtISO !== "");
  const invalidTimestampCount = rows.filter((r) => !r.startedAtISO || r.parseError).length;

  let earliestCall: string | null = null;
  let latestCall: string | null = null;
  const hourCounts: Record<number, number> = {};

  for (const r of validRows) {
    const d = new Date(r.startedAtISO);
    if (isNaN(d.getTime())) continue;
    if (!earliestCall || r.startedAtISO < earliestCall) earliestCall = r.startedAtISO;
    if (!latestCall || r.startedAtISO > latestCall) latestCall = r.startedAtISO;
    hourCounts[r.hourKey] = (hourCounts[r.hourKey] ?? 0) + 1;
  }

  function hourLabel(h: number): string {
    if (h === 0) return "12AM";
    if (h < 12) return `${h}AM`;
    if (h === 12) return "12PM";
    return `${h - 12}PM`;
  }

  const busiestHours = Object.entries(hourCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([h, count]) => ({ hour: Number(h), label: hourLabel(Number(h)), count }));

  return {
    importedCount: rows.length,
    skippedCount,
    invalidTimestampCount,
    earliestCall,
    latestCall,
    busiestHours,
    detectedColumns,
  };
}

// ──────────────────────────────────────────────
// Standard CSV: Name,Number,Date,Time,Duration,Status,Notes
// ──────────────────────────────────────────────

function parseStandardCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const keys = result.meta.fields ?? [];
  const find = makeFinder(keys);
  let skipped = 0;

  const nameKey = find(["Name", "CallerName", "Caller Name", "caller_name"]);
  const numberKey = find(["Number", "Phone", "phone_number", "PhoneNumber"]);
  const dateKey_ = find(["Date", "Call Date", "CallDate", "Start Date"]);
  const timeKey = find(["Time", "Call Time", "Start Time", "CallTime", "StartTime", "Timestamp"]);
  const durationKey = find(["Duration", "duration", "Length", "Seconds", "Call Length"]);
  const statusKey = find(["Status", "Result", "Type", "Call Type"]);
  const notesKey = find(["Notes", "Note", "Info", "Comment", "Description"]);

  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    try {
      const name = (nameKey ? r[nameKey] : undefined) ?? "";
      const number = (numberKey ? r[numberKey] : undefined) ?? "";
      const dateRaw = (dateKey_ ? r[dateKey_] : undefined) ?? "";
      const timeRaw = (timeKey ? r[timeKey] : undefined) ?? "";
      const durationRaw = (durationKey ? r[durationKey] : undefined) ?? "0";
      const status = normalizeStatus((statusKey ? r[statusKey] : undefined) ?? "Other");
      const notes = (notesKey ? r[notesKey] : undefined) ?? "";

      // Check if time looks like unix seconds (MicroSIP-style in standard-csv)
      const tsNum = parseInt(timeRaw, 10);
      const isUnixTs = !isNaN(tsNum) && tsNum >= 1_000_000_000;

      let ts: ReturnType<typeof parseDatetime>;
      if (isUnixTs) {
        const u = unixToDatetime(timeRaw);
        ts = { date: u.date, time: u.time, hour: u.hour, startedAtISO: u.startedAtISO, dateKey: u.dateKey, hourKey: u.hourKey };
      } else {
        ts = parseDatetime(dateRaw, timeRaw);
      }

      if (!ts.dateKey) {
        skipped++;
        errors.push(`Row ${i + 2}: Invalid timestamp (date="${dateRaw}" time="${timeRaw}") — skipped`);
        continue;
      }

      rows.push({
        callerName: name, phoneNumber: number,
        date: ts.date, time: ts.time,
        durationSeconds: parseDurationToSeconds(durationRaw),
        status, notes,
        startedAtISO: ts.startedAtISO, dateKey: ts.dateKey, hourKey: ts.hourKey,
        rawTime: dateRaw ? `${dateRaw} ${timeRaw}`.trim() : timeRaw || undefined,
      });
    } catch (e) {
      errors.push(`Row ${i + 2}: ${String(e)}`);
    }
  }

  const debug = buildDebug(rows, skipped, keys);
  return { rows, errors, format: "standard-csv", debug };
}

// ──────────────────────────────────────────────
// MicroSIP CSV
// Supports: Type/Direction, Name, Number, Time (unix OR HH:MM:SS), Date (optional), Duration, Info/Notes
// ──────────────────────────────────────────────

function parseMicroSIPCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const keys = result.meta.fields ?? [];
  const find = makeFinder(keys);
  let skipped = 0;

  // Fuzzy-match all expected columns — covers many MicroSIP export variants
  const typeKey = find(["Type", "Direction", "Call Direction", "CallType", "Call Type"]);
  const nameKey = find(["Name", "CallerName", "Caller Name", "Contact"]);
  const numberKey = find(["Number", "Phone", "Phone Number", "PhoneNumber", "Caller", "From", "To"]);
  // Date column is optional — classic MicroSIP has none (unix timestamp in Time)
  const dateKey_ = find(["Date", "Call Date", "CallDate", "Start Date", "StartDate"]);
  // Time column — could be unix seconds OR HH:MM:SS, with or without a separate Date column
  const timeKey = find(["Time", "Call Time", "Start Time", "CallTime", "StartTime", "Timestamp", "Unix Time", "Unix"]);
  const durationKey = find(["Duration", "Call Duration", "CallDuration", "Length", "Seconds"]);
  const infoKey = find(["Info", "Notes", "Note", "Description", "Result", "Status", "Comment"]);

  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    try {
      const typeRaw = (typeKey ? r[typeKey] : undefined) ?? "";
      const name = (nameKey ? r[nameKey] : undefined) ?? "";
      const number = (numberKey ? r[numberKey] : undefined) ?? "";
      const durationRaw = (durationKey ? r[durationKey] : undefined) ?? "0";
      const info = (infoKey ? r[infoKey] : undefined) ?? "";
      const timeRaw = (timeKey ? r[timeKey] : undefined) ?? "";
      const dateRaw = (dateKey_ ? r[dateKey_] : undefined) ?? "";

      // Determine timestamp type:
      // 1. Unix seconds ≥ 1_000_000_000 (classic MicroSIP CSV)
      // 2. Human-readable HH:MM:SS + separate Date column
      // 3. Full datetime string in the Time column (e.g. "2025-04-15 09:30:00")
      const tsNum = parseInt(timeRaw, 10);
      const isUnixTs = !isNaN(tsNum) && tsNum >= 1_000_000_000;

      let ts: { date: string; time: string; hour: number; startedAtISO: string; dateKey: string; hourKey: number };

      if (isUnixTs) {
        // Classic MicroSIP: Time = unix seconds
        ts = unixToDatetime(timeRaw);
      } else if (dateRaw) {
        // Has a separate Date column — parse Date + Time string
        ts = parseDatetime(dateRaw, timeRaw);
      } else {
        // Time column may contain a full datetime string like "2025-04-15 09:30:00"
        ts = parseDatetime(timeRaw, "");
        // If that failed, try as a bare date
        if (!ts.dateKey && timeRaw) {
          const d = new Date(timeRaw);
          if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
            ts = {
              date: localDateKey(d), time: localTimeStr(d), hour: d.getHours(),
              startedAtISO: d.toISOString(), dateKey: localDateKey(d), hourKey: d.getHours(),
            };
          }
        }
      }

      if (!ts.dateKey) {
        skipped++;
        errors.push(`Row ${i + 2}: Cannot parse timestamp (time="${timeRaw}" date="${dateRaw}") — skipped`);
        continue;
      }

      const status = resolveMicroSIPStatus(info, typeRaw);
      const durationSeconds = parseDurationToSeconds(durationRaw);

      rows.push({
        callerName: name, phoneNumber: number,
        date: ts.date, time: ts.time,
        durationSeconds, status, notes: info,
        startedAtISO: ts.startedAtISO, dateKey: ts.dateKey, hourKey: ts.hourKey,
        rawTime: isUnixTs ? timeRaw : (dateRaw ? `${dateRaw} ${timeRaw}`.trim() : timeRaw) || undefined,
      });
    } catch (e) {
      errors.push(`Row ${i + 2}: ${String(e)}`);
    }
  }

  const debug = buildDebug(rows, skipped, keys);
  return { rows, errors, format: "microsip-csv", debug };
}

// ──────────────────────────────────────────────
// MicroSIP INI
// ──────────────────────────────────────────────

function parseMicroSIPINI(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const lines = text.split("\n");
  let skipped = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith(";") ||
      trimmed.includes("callsLastKey") || !trimmed.match(/^\d+=./)) continue;

    try {
      const eqIdx = trimmed.indexOf("=");
      const value = trimmed.slice(eqIdx + 1);
      const parts = value.split(";");
      if (parts.length < 5) continue;

      const [number, name, typeRaw, unixTime, durationRaw, ...infoParts] = parts;
      const info = infoParts.join(";");
      const ts = unixToDatetime(unixTime);
      const status = resolveMicroSIPStatus(info, typeRaw);
      const durationSeconds = parseDurationToSeconds(durationRaw);

      if (!ts.dateKey) {
        skipped++;
        errors.push(`INI line: Cannot parse unix timestamp "${unixTime}" — skipped`);
        continue;
      }

      rows.push({
        callerName: name ?? "", phoneNumber: number ?? "",
        date: ts.date, time: ts.time,
        durationSeconds, status, notes: info,
        startedAtISO: ts.startedAtISO, dateKey: ts.dateKey, hourKey: ts.hourKey,
        rawTime: unixTime,
      });
    } catch (e) {
      errors.push(`INI line "${trimmed.slice(0, 40)}": ${String(e)}`);
    }
  }

  const debug = buildDebug(rows, skipped, []);
  return { rows, errors, format: "microsip-ini", debug };
}

// ──────────────────────────────────────────────
// MicroSIP XML
// ──────────────────────────────────────────────

function parseMicroSIPXML(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return { rows: [], errors: ["XML import failed. Try CSV export instead."], format: "microsip-xml" };
    }

    const calls = Array.from(doc.querySelectorAll("call"));
    for (let i = 0; i < calls.length; i++) {
      try {
        const el = calls[i];
        const typeRaw = el.getAttribute("type") ?? "";
        const name = el.getAttribute("name") ?? "";
        const number = el.getAttribute("number") ?? "";
        const unixTime = el.getAttribute("time") ?? "0";
        const durationRaw = el.getAttribute("duration") ?? "0";
        const info = el.getAttribute("info") ?? "";

        const ts = unixToDatetime(unixTime);
        const status = resolveMicroSIPStatus(info, typeRaw);
        const durationSeconds = parseDurationToSeconds(durationRaw);

        if (!ts.dateKey) {
          skipped++;
          errors.push(`XML call ${i}: Cannot parse timestamp "${unixTime}" — skipped`);
          continue;
        }

        rows.push({
          callerName: name, phoneNumber: number,
          date: ts.date, time: ts.time,
          durationSeconds, status, notes: info,
          startedAtISO: ts.startedAtISO, dateKey: ts.dateKey, hourKey: ts.hourKey,
          rawTime: unixTime,
        });
      } catch (e) {
        errors.push(`XML call element ${i}: ${String(e)}`);
      }
    }
  } catch (e) {
    return { rows: [], errors: ["XML import failed. Try CSV export instead."], format: "microsip-xml" };
  }

  const debug = buildDebug(rows, skipped, []);
  return { rows, errors, format: "microsip-xml", debug };
}

// ──────────────────────────────────────────────
// Callcentric CSV — flexible column detection
// ──────────────────────────────────────────────

function parseCallcentricCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const keys = result.meta.fields ?? [];
  const find = makeFinder(keys);
  let skipped = 0;

  const nameKey = find(["Name", "CallerName", "Caller", "CallerID", "Caller ID"]);
  const numberKey = find(["Number", "Phone", "From", "To", "DID", "Extension"]);
  const dateKey_ = find(["Date", "Call Date"]);
  const timeKey = find(["Time", "Start Time", "Call Time"]);
  const durationKey = find(["Duration", "Length", "Seconds"]);
  const statusKey = find(["Status", "Result", "Direction", "Type", "Info"]);
  const notesKey = find(["Notes", "Note", "Comment", "Info", "Description"]);

  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    try {
      const name = (nameKey ? r[nameKey] : undefined) ?? "";
      const number = (numberKey ? r[numberKey] : undefined) ?? "";
      const dateRaw = (dateKey_ ? r[dateKey_] : undefined) ?? "";
      const timeRaw = (timeKey ? r[timeKey] : undefined) ?? "";
      const durationRaw = (durationKey ? r[durationKey] : undefined) ?? "0";
      const status = normalizeStatus((statusKey ? r[statusKey] : undefined) ?? "Other");
      const notes = (notesKey ? r[notesKey] : undefined) ?? "";

      const ts = parseDatetime(dateRaw, timeRaw);

      if (!ts.dateKey) {
        skipped++;
        errors.push(`Row ${i + 2}: Invalid timestamp (date="${dateRaw}" time="${timeRaw}") — skipped`);
        continue;
      }

      rows.push({
        callerName: name, phoneNumber: number,
        date: ts.date, time: ts.time,
        durationSeconds: parseDurationToSeconds(durationRaw),
        status, notes,
        startedAtISO: ts.startedAtISO, dateKey: ts.dateKey, hourKey: ts.hourKey,
        rawTime: dateRaw ? `${dateRaw} ${timeRaw}`.trim() : undefined,
      });
    } catch (e) {
      errors.push(`Row ${i + 2}: ${String(e)}`);
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("Import failed: could not detect call-log format. Expected columns: Name, Number, Date, Time, Duration, Status, Notes");
  }

  const debug = buildDebug(rows, skipped, keys);
  return { rows, errors, format: "callcentric-csv", debug };
}
