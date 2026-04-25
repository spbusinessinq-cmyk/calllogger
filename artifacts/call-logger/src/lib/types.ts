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
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
  total: number;
  format: string;
  timestamp: string;
}

export interface ParsedRow {
  callerName: string;
  phoneNumber: string;
  date: string;
  time: string;
  durationSeconds: number;
  status: CallStatus;
  notes: string;
}
