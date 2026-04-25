export type CallStatus =
  | "Answered"
  | "Call Ended"
  | "Missed"
  | "Canceled"
  | "Voicemail"
  | "Outgoing"
  | "Other";

export type CallSource =
  | "sample"
  | "manual"
  | "standard-csv"
  | "microsip-csv"
  | "microsip-ini"
  | "microsip-xml"
  | "callcentric-csv"
  | "unknown";

export interface StoredCall {
  callerName: string;
  phoneNumber: string;
  maskedNumber: string;
  date: string;
  time: string;
  hour: number;
  durationSeconds: number;
  duration: string;
  status: CallStatus;
  notes: string;
  source: CallSource;
  dedupeKey: string;
  importedAt: string;
  // Canonical timestamp fields — populated by parsers and backfilled by migration
  startedAtISO: string;   // ISO 8601 UTC (e.g. "2026-04-25T10:43:41.000Z") or ""
  dateKey: string;        // Local YYYY-MM-DD (e.g. "2026-04-25") or ""
  hourKey: number;        // Local 0-23 hour
  rawTime?: string;       // Raw time value from source (unix seconds or date string) for re-parsing
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
  total: number;
  format: string;
  timestamp: string;
  parseErrors?: number;
  timestampErrors?: number;
}

export interface ParsedRow {
  callerName: string;
  phoneNumber: string;
  date: string;
  time: string;
  durationSeconds: number;
  status: CallStatus;
  notes: string;
  // Canonical timestamp fields
  startedAtISO: string;
  dateKey: string;
  hourKey: number;
  rawTime?: string;
  parseError?: string;
}
