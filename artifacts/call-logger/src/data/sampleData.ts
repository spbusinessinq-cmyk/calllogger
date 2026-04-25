export type CallStatus = "Answered" | "Call Ended" | "Missed" | "Canceled" | "Voicemail";

export interface CallRecord {
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
}

export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  const first = digits.slice(0, 4);
  const last = digits.slice(-2);
  const masked = "*".repeat(digits.length - 6);
  return `${first}${masked}${last}`;
}

export function formatDuration(seconds: number): string {
  if (seconds === 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

export const SAMPLE_DATA: CallRecord[] = [
  { callerName: "Maria Delgado", phoneNumber: "13235551212", maskedNumber: "1323******12", date: "2025-04-01", time: "08:14", hour: 8, durationSeconds: 312, duration: "5m 12s", status: "Answered", notes: "Follow-up needed on case #4421" },
  { callerName: "James Porter", phoneNumber: "13105559876", maskedNumber: "1310******76", date: "2025-04-01", time: "09:02", hour: 9, durationSeconds: 0, duration: "0s", status: "Missed", notes: "" },
  { callerName: "Sandra Lee", phoneNumber: "17145553344", maskedNumber: "1714******44", date: "2025-04-01", time: "09:47", hour: 9, durationSeconds: 88, duration: "1m 28s", status: "Call Ended", notes: "Left detailed voicemail" },
  { callerName: "Victor Huang", phoneNumber: "12135557788", maskedNumber: "2135*****88", date: "2025-04-01", time: "10:33", hour: 10, durationSeconds: 475, duration: "7m 55s", status: "Answered", notes: "Requested callback by 5PM" },
  { callerName: "Maria Delgado", phoneNumber: "13235551212", maskedNumber: "1323******12", date: "2025-04-01", time: "11:05", hour: 11, durationSeconds: 0, duration: "0s", status: "Canceled", notes: "" },
  { callerName: "Tony Reyes", phoneNumber: "16265550011", maskedNumber: "1626******11", date: "2025-04-01", time: "11:58", hour: 11, durationSeconds: 210, duration: "3m 30s", status: "Answered", notes: "" },
  { callerName: "Patricia Wu", phoneNumber: "19495554567", maskedNumber: "1949******67", date: "2025-04-01", time: "13:15", hour: 13, durationSeconds: 125, duration: "2m 5s", status: "Voicemail", notes: "Wants renewal info" },
  { callerName: "David Kim", phoneNumber: "13105551234", maskedNumber: "1310******34", date: "2025-04-01", time: "14:02", hour: 14, durationSeconds: 623, duration: "10m 23s", status: "Answered", notes: "Long call - escalation request" },
  { callerName: "Sandra Lee", phoneNumber: "17145553344", maskedNumber: "1714******44", date: "2025-04-01", time: "14:50", hour: 14, durationSeconds: 0, duration: "0s", status: "Missed", notes: "" },
  { callerName: "James Porter", phoneNumber: "13105559876", maskedNumber: "1310******76", date: "2025-04-01", time: "15:22", hour: 15, durationSeconds: 55, duration: "55s", status: "Call Ended", notes: "" },
  { callerName: "Alicia Monroe", phoneNumber: "14155552233", maskedNumber: "1415******33", date: "2025-04-02", time: "08:05", hour: 8, durationSeconds: 390, duration: "6m 30s", status: "Answered", notes: "New intake call" },
  { callerName: "Victor Huang", phoneNumber: "12135557788", maskedNumber: "2135*****88", date: "2025-04-02", time: "09:30", hour: 9, durationSeconds: 0, duration: "0s", status: "Missed", notes: "" },
  { callerName: "Maria Delgado", phoneNumber: "13235551212", maskedNumber: "1323******12", date: "2025-04-02", time: "10:15", hour: 10, durationSeconds: 540, duration: "9m 0s", status: "Answered", notes: "Case escalated to supervisor" },
  { callerName: "Robert Chase", phoneNumber: "18185550099", maskedNumber: "1818******99", date: "2025-04-02", time: "10:55", hour: 10, durationSeconds: 0, duration: "0s", status: "Canceled", notes: "" },
  { callerName: "Linda Park", phoneNumber: "16265558877", maskedNumber: "1626******77", date: "2025-04-02", time: "11:40", hour: 11, durationSeconds: 180, duration: "3m 0s", status: "Call Ended", notes: "Issue resolved" },
  { callerName: "Tony Reyes", phoneNumber: "16265550011", maskedNumber: "1626******11", date: "2025-04-02", time: "13:00", hour: 13, durationSeconds: 95, duration: "1m 35s", status: "Voicemail", notes: "" },
  { callerName: "David Kim", phoneNumber: "13105551234", maskedNumber: "1310******34", date: "2025-04-02", time: "14:10", hour: 14, durationSeconds: 285, duration: "4m 45s", status: "Answered", notes: "Follow-up from previous case" },
  { callerName: "Nancy Torres", phoneNumber: "17145556655", maskedNumber: "1714******55", date: "2025-04-02", time: "15:05", hour: 15, durationSeconds: 0, duration: "0s", status: "Missed", notes: "" },
  { callerName: "James Porter", phoneNumber: "13105559876", maskedNumber: "1310******76", date: "2025-04-03", time: "08:45", hour: 8, durationSeconds: 445, duration: "7m 25s", status: "Answered", notes: "Third contact this week" },
  { callerName: "Sandra Lee", phoneNumber: "17145553344", maskedNumber: "1714******44", date: "2025-04-03", time: "09:20", hour: 9, durationSeconds: 120, duration: "2m 0s", status: "Answered", notes: "" },
  { callerName: "Patricia Wu", phoneNumber: "19495554567", maskedNumber: "1949******67", date: "2025-04-03", time: "10:00", hour: 10, durationSeconds: 0, duration: "0s", status: "Missed", notes: "" },
  { callerName: "Robert Chase", phoneNumber: "18185550099", maskedNumber: "1818******99", date: "2025-04-03", time: "10:48", hour: 10, durationSeconds: 760, duration: "12m 40s", status: "Answered", notes: "Longest call this week - complex case" },
  { callerName: "Alicia Monroe", phoneNumber: "14155552233", maskedNumber: "1415******33", date: "2025-04-03", time: "11:30", hour: 11, durationSeconds: 200, duration: "3m 20s", status: "Call Ended", notes: "" },
  { callerName: "Victor Huang", phoneNumber: "12135557788", maskedNumber: "2135*****88", date: "2025-04-03", time: "13:25", hour: 13, durationSeconds: 310, duration: "5m 10s", status: "Answered", notes: "Needs paperwork sent" },
  { callerName: "Maria Delgado", phoneNumber: "13235551212", maskedNumber: "1323******12", date: "2025-04-03", time: "14:40", hour: 14, durationSeconds: 0, duration: "0s", status: "Voicemail", notes: "4th contact - urgent" },
  { callerName: "Tony Reyes", phoneNumber: "16265550011", maskedNumber: "1626******11", date: "2025-04-04", time: "09:05", hour: 9, durationSeconds: 430, duration: "7m 10s", status: "Answered", notes: "" },
  { callerName: "Linda Park", phoneNumber: "16265558877", maskedNumber: "1626******77", date: "2025-04-04", time: "10:20", hour: 10, durationSeconds: 0, duration: "0s", status: "Canceled", notes: "" },
  { callerName: "David Kim", phoneNumber: "13105551234", maskedNumber: "1310******34", date: "2025-04-04", time: "11:15", hour: 11, durationSeconds: 195, duration: "3m 15s", status: "Call Ended", notes: "" },
  { callerName: "Nancy Torres", phoneNumber: "17145556655", maskedNumber: "1714******55", date: "2025-04-04", time: "13:50", hour: 13, durationSeconds: 270, duration: "4m 30s", status: "Answered", notes: "Referred to case manager" },
  { callerName: "James Porter", phoneNumber: "13105559876", maskedNumber: "1310******76", date: "2025-04-04", time: "14:30", hour: 14, durationSeconds: 0, duration: "0s", status: "Missed", notes: "" },
  { callerName: "Patricia Wu", phoneNumber: "19495554567", maskedNumber: "1949******67", date: "2025-04-04", time: "15:10", hour: 15, durationSeconds: 155, duration: "2m 35s", status: "Voicemail", notes: "Third voicemail left" },
  { callerName: "Sandra Lee", phoneNumber: "17145553344", maskedNumber: "1714******44", date: "2025-04-05", time: "09:00", hour: 9, durationSeconds: 380, duration: "6m 20s", status: "Answered", notes: "" },
  { callerName: "Alicia Monroe", phoneNumber: "14155552233", maskedNumber: "1415******33", date: "2025-04-05", time: "10:35", hour: 10, durationSeconds: 0, duration: "0s", status: "Missed", notes: "" },
  { callerName: "Robert Chase", phoneNumber: "18185550099", maskedNumber: "1818******99", date: "2025-04-05", time: "11:05", hour: 11, durationSeconds: 505, duration: "8m 25s", status: "Answered", notes: "Review scheduled" },
  { callerName: "Victor Huang", phoneNumber: "12135557788", maskedNumber: "2135*****88", date: "2025-04-05", time: "13:00", hour: 13, durationSeconds: 0, duration: "0s", status: "Canceled", notes: "" },
  { callerName: "Maria Delgado", phoneNumber: "13235551212", maskedNumber: "1323******12", date: "2025-04-05", time: "14:15", hour: 14, durationSeconds: 220, duration: "3m 40s", status: "Call Ended", notes: "Resolved" },
  { callerName: "Tony Reyes", phoneNumber: "16265550011", maskedNumber: "1626******11", date: "2025-04-05", time: "15:30", hour: 15, durationSeconds: 340, duration: "5m 40s", status: "Answered", notes: "" },
];
