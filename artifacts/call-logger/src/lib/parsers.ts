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

// Used by Standard CSV and Callcentric parsers where a single status column exists.
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

// Single canonical function for deriving a CallStatus from any notes/info text.
// Used both by import parsers and the stored-call migration.
// Notes field contains the original MicroSIP Info value which is the most reliable signal.
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

// MicroSIP two-field resolution:
// 1. Inspect Info for descriptive keywords (highest priority)
// 2. Fall back to Type code only if Info gives no signal
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
  if (t === "in" || t === "answered") return "Answered";
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
  return total;
}

// Format a local date as YYYY-MM-DD using LOCAL date methods (not UTC).
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Format local time as HH:MM
function localTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Convert Unix timestamp (seconds) to canonical fields using LOCAL time.
// Critical: toISOString() returns UTC date which may be a different calendar day.
// Always use getFullYear/getMonth/getDate for dateKey.
export function unixToDatetime(unix: string | number): {
  date: string; time: string; hour: number;
  startedAtISO: string; dateKey: string; hourKey: number;
} {
  const ts = typeof unix === "string" ? parseInt(unix, 10) : unix;
  if (isNaN(ts) || ts <= 0) return { date: "", time: "", hour: 0, startedAtISO: "", dateKey: "", hourKey: 0 };
  const d = new Date(ts * 1000);
  const dateKey = localDateKey(d);
  const time = localTimeStr(d);
  const hourKey = d.getHours();
  return { date: dateKey, time, hour: hourKey, startedAtISO: d.toISOString(), dateKey, hourKey };
}

// Robust Standard CSV date+time parsing.
// Accepts many formats: YYYY-MM-DD, M/D/YYYY, "Apr 25 2026" + HH:MM, HH:MM:SS, h:MM PM
export function parseDatetime(dateRaw: string, timeRaw: string): {
  date: string; time: string; hour: number;
  startedAtISO: string; dateKey: string; hourKey: number;
} {
  const dateStr = dateRaw.trim();
  const timeStr = timeRaw.trim();

  // Normalize date: convert M/D/YYYY → YYYY-MM-DD
  function normalizeDate(s: string): string {
    // M/D/YYYY or MM/DD/YYYY
    const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
    }
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // "Apr 25 2026" or "April 25, 2026"
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return localDateKey(d);
    } catch { /* ignore */ }
    return s;
  }

  // Normalize time: convert 12-hour to 24-hour
  function normalizeTime(s: string): string {
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
    if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
    return s;
  }

  const normalDate = normalizeDate(dateStr);
  const normalTime = normalizeTime(timeStr);

  if (normalDate && normalTime) {
    const combined = `${normalDate}T${normalTime}`;
    const d = new Date(combined);
    if (!isNaN(d.getTime())) {
      return {
        date: localDateKey(d),
        time: localTimeStr(d),
        hour: d.getHours(),
        startedAtISO: d.toISOString(),
        dateKey: localDateKey(d),
        hourKey: d.getHours(),
      };
    }
  }

  if (normalDate) {
    const d = new Date(normalDate + "T12:00:00");
    if (!isNaN(d.getTime())) {
      const hour = normalTime ? parseInt(normalTime.split(":")[0], 10) : 0;
      const safeHour = isNaN(hour) ? 0 : hour;
      return {
        date: localDateKey(d),
        time: normalTime || "",
        hour: safeHour,
        startedAtISO: "",
        dateKey: localDateKey(d),
        hourKey: safeHour,
      };
    }
  }

  // Fallback: raw strings, no ISO
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
  if (trimmed.startsWith("[Calls]") || trimmed.startsWith("[Settings]") || /^\d+=\S+;/.test(trimmed.split("\n").find(l => /^\d+=/.test(l.trim())) ?? "")) {
    return "microsip-ini";
  }
  const firstLine = trimmed.split("\n")[0].toLowerCase().replace(/\s/g, "");
  if (firstLine.includes("type,name,number") || firstLine.includes("type,number,name")) {
    return "microsip-csv";
  }
  if (
    firstLine.includes("name,number") &&
    (firstLine.includes("date") || firstLine.includes("time"))
  ) {
    return "standard-csv";
  }
  if (
    firstLine.includes("direction") ||
    firstLine.includes("callerid") ||
    firstLine.includes("caller id")
  ) {
    return "callcentric-csv";
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
// Parsers
// ──────────────────────────────────────────────

export interface ParseResult {
  rows: ParsedRow[];
  errors: string[];
  format: DetectedFormat;
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
      return { rows: [], errors: ["Could not detect call-log format. Expected columns: Name,Number,Date,Time,Duration,Status,Notes"], format };
  }
}

// Standard CSV: Name,Number,Date,Time,Duration,Status,Notes
function parseStandardCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    try {
      const name = r["Name"] ?? r["name"] ?? r["CallerName"] ?? r["caller_name"] ?? "";
      const number = r["Number"] ?? r["number"] ?? r["Phone"] ?? r["phone"] ?? "";
      const dateRaw = r["Date"] ?? r["date"] ?? "";
      const timeRaw = r["Time"] ?? r["time"] ?? "";
      const durationRaw = r["Duration"] ?? r["duration"] ?? "0";
      const status = normalizeStatus(r["Status"] ?? r["status"] ?? "Other");
      const notes = r["Notes"] ?? r["notes"] ?? r["Info"] ?? r["info"] ?? "";

      const ts = parseDatetime(dateRaw, timeRaw);

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
  return { rows, errors, format: "standard-csv" };
}

// MicroSIP CSV: Type,Name,Number,Time,Duration,Info
function parseMicroSIPCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    try {
      const typeRaw = r["Type"] ?? r["type"] ?? "";
      const name = r["Name"] ?? r["name"] ?? "";
      const number = r["Number"] ?? r["number"] ?? "";
      const timeRaw = r["Time"] ?? r["time"] ?? "0";
      const durationRaw = r["Duration"] ?? r["duration"] ?? "0";
      const info = r["Info"] ?? r["info"] ?? "";

      const ts = unixToDatetime(timeRaw);
      const status = resolveMicroSIPStatus(info, typeRaw);
      const durationSeconds = parseDurationToSeconds(durationRaw);

      if (!ts.dateKey) {
        errors.push(`Row ${i + 2}: Could not parse unix timestamp "${timeRaw}"`);
      }

      rows.push({
        callerName: name, phoneNumber: number,
        date: ts.date, time: ts.time,
        durationSeconds, status, notes: info,
        startedAtISO: ts.startedAtISO, dateKey: ts.dateKey, hourKey: ts.hourKey,
        rawTime: timeRaw,
      });
    } catch (e) {
      errors.push(`Row ${i + 2}: ${String(e)}`);
    }
  }
  return { rows, errors, format: "microsip-csv" };
}

// MicroSIP INI: [Calls]\n0=number;name;type;unix_time;duration_seconds;info
function parseMicroSIPINI(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith(";") || trimmed.includes("callsLastKey") || !trimmed.match(/^\d+=./)) continue;

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
        errors.push(`INI line: Could not parse unix timestamp "${unixTime}"`);
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
  return { rows, errors, format: "microsip-ini" };
}

// MicroSIP XML: <call type="" name="" number="" time="" duration="" info="" />
function parseMicroSIPXML(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];

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
          errors.push(`XML call ${i}: Could not parse unix timestamp "${unixTime}"`);
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

  return { rows, errors, format: "microsip-xml" };
}

// Callcentric CSV — flexible column detection
function parseCallcentricCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const keys = result.meta.fields ?? [];

  const findKey = (candidates: string[]): string | undefined =>
    keys.find((k) => candidates.some((c) => k.toLowerCase().includes(c.toLowerCase())));

  const nameKey = findKey(["Name", "CallerName", "Caller", "CallerID", "Caller ID"]);
  const numberKey = findKey(["Number", "Phone", "From", "To", "DID", "Extension"]);
  const dateKey_ = findKey(["Date"]);
  const timeKey = findKey(["Time"]);
  const durationKey = findKey(["Duration", "Length", "Seconds"]);
  const statusKey = findKey(["Status", "Result", "Direction", "Type", "Info"]);
  const notesKey = findKey(["Notes", "Note", "Comment", "Info", "Description"]);

  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    try {
      const name = nameKey ? (r[nameKey] ?? "") : "";
      const number = numberKey ? (r[numberKey] ?? "") : "";
      const dateRaw = dateKey_ ? (r[dateKey_] ?? "") : "";
      const timeRaw = timeKey ? (r[timeKey] ?? "") : "";
      const durationRaw = durationKey ? (r[durationKey] ?? "0") : "0";
      const status = normalizeStatus(statusKey ? (r[statusKey] ?? "Other") : "Other");
      const notes = notesKey ? (r[notesKey] ?? "") : "";

      const ts = parseDatetime(dateRaw, timeRaw);

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

  return { rows, errors, format: "callcentric-csv" };
}
