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
  if (s === "voicemail") return "Voicemail";
  if (s === "out" || s === "outgoing") return "Outgoing";
  if (s === "else" || s === "other") return "Other";
  // MicroSIP INI numeric types
  if (s === "0") return "Outgoing";
  if (s === "1") return "Answered";
  if (s === "2") return "Missed";
  if (s === "3") return "Other";
  return "Other";
}

// Returns a note string for MicroSIP type values that map to a different canonical status,
// so the original type label is preserved in the notes field.
function typeNote(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "answered elsewhere") return "Answered Elsewhere";
  if (s === "declined") return "Declined";
  return "";
}

function withTypeNote(info: string, raw: string): string {
  const note = typeNote(raw);
  if (!note) return info;
  return info ? `${note} — ${info}` : note;
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

function unixToDatetime(unix: string | number): { date: string; time: string; hour: number } {
  const ts = typeof unix === "string" ? parseInt(unix, 10) : unix;
  if (isNaN(ts) || ts === 0) return { date: "", time: "", hour: 0 };
  const d = new Date(ts * 1000);
  const date = d.toISOString().slice(0, 10);
  const time = d.toTimeString().slice(0, 5);
  const hour = d.getHours();
  return { date, time, hour };
}

function parseDatetime(date: string, time: string): { date: string; time: string; hour: number } {
  const hour = time ? parseInt(time.split(":")[0], 10) : 0;
  return { date: date.trim(), time: time.trim(), hour };
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
    hour: row.time ? parseInt(row.time.split(":")[0], 10) : 0,
    durationSeconds: row.durationSeconds,
    duration: formatDuration(row.durationSeconds),
    status: row.status,
    notes: row.notes.trim(),
    source,
    dedupeKey,
    importedAt: new Date().toISOString(),
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
  // Try to detect callcentric
  if (
    firstLine.includes("direction") ||
    firstLine.includes("callerid") ||
    firstLine.includes("caller id")
  ) {
    return "callcentric-csv";
  }
  // Generic CSV fallback
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

// Standard CSV
function parseStandardCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    try {
      const name = r["Name"] ?? r["name"] ?? r["CallerName"] ?? r["caller_name"] ?? "";
      const number = r["Number"] ?? r["number"] ?? r["Phone"] ?? r["phone"] ?? "";
      const date = r["Date"] ?? r["date"] ?? "";
      const time = r["Time"] ?? r["time"] ?? "";
      const durationRaw = r["Duration"] ?? r["duration"] ?? "0";
      const status = normalizeStatus(r["Status"] ?? r["status"] ?? "Other");
      const notes = r["Notes"] ?? r["notes"] ?? r["Info"] ?? r["info"] ?? "";

      rows.push({ callerName: name, phoneNumber: number, date, time, durationSeconds: parseDurationToSeconds(durationRaw), status, notes });
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

      const { date, time } = unixToDatetime(timeRaw);
      const status = normalizeStatus(typeRaw);
      const durationSeconds = parseDurationToSeconds(durationRaw);

      rows.push({ callerName: name, phoneNumber: number, date, time, durationSeconds, status, notes: withTypeNote(info, typeRaw) });
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
      const { date, time } = unixToDatetime(unixTime);
      const status = normalizeStatus(typeRaw);
      const durationSeconds = parseDurationToSeconds(durationRaw);

      rows.push({ callerName: name ?? "", phoneNumber: number ?? "", date, time, durationSeconds, status, notes: withTypeNote(info, typeRaw) });
    } catch (e) {
      errors.push(`INI line "${trimmed.slice(0, 40)}": ${String(e)}`);
    }
  }
  return { rows, errors, format: "microsip-ini" };
}

// MicroSIP XML
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

        const { date, time } = unixToDatetime(unixTime);
        const status = normalizeStatus(typeRaw);
        const durationSeconds = parseDurationToSeconds(durationRaw);

        rows.push({ callerName: name, phoneNumber: number, date, time, durationSeconds, status, notes: withTypeNote(info, typeRaw) });
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
  const dateKey = findKey(["Date"]);
  const timeKey = findKey(["Time"]);
  const durationKey = findKey(["Duration", "Length", "Seconds"]);
  const statusKey = findKey(["Status", "Result", "Direction", "Type", "Info"]);
  const notesKey = findKey(["Notes", "Note", "Comment", "Info", "Description"]);

  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    try {
      const name = nameKey ? (r[nameKey] ?? "") : "";
      const number = numberKey ? (r[numberKey] ?? "") : "";
      const date = dateKey ? (r[dateKey] ?? "") : "";
      const time = timeKey ? (r[timeKey] ?? "") : "";
      const durationRaw = durationKey ? (r[durationKey] ?? "0") : "0";
      const status = normalizeStatus(statusKey ? (r[statusKey] ?? "Other") : "Other");
      const notes = notesKey ? (r[notesKey] ?? "") : "";

      rows.push({ callerName: name, phoneNumber: number, date, time, durationSeconds: parseDurationToSeconds(durationRaw), status, notes });
    } catch (e) {
      errors.push(`Row ${i + 2}: ${String(e)}`);
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("Import failed: could not detect call-log format. Expected columns: Name, Number, Date, Time, Duration, Status, Notes");
  }

  return { rows, errors, format: "callcentric-csv" };
}
