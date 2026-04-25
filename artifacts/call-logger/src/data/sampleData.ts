import { type StoredCall } from "@/lib/types";
import { maskPhone, formatDuration } from "@/lib/utils";
import { makeDedupeKey } from "@/lib/parsers";

function makeCall(
  callerName: string,
  phoneNumber: string,
  date: string,
  time: string,
  durationSeconds: number,
  status: StoredCall["status"],
  notes: string
): StoredCall {
  const phone = phoneNumber.replace(/\D/g, "");
  const hour = parseInt(time.split(":")[0], 10);
  const dedupeKey = makeDedupeKey({ phoneNumber: phone, callerName, date, time, durationSeconds, status });
  return {
    callerName,
    phoneNumber: phone,
    maskedNumber: maskPhone(phone),
    date,
    time,
    hour,
    durationSeconds,
    duration: formatDuration(durationSeconds),
    status,
    notes,
    source: "sample",
    dedupeKey,
    importedAt: new Date().toISOString(),
  };
}

export const SAMPLE_DATA: StoredCall[] = [
  makeCall("Maria Delgado", "13235551212", "2025-04-01", "08:14", 312, "Answered", "Follow-up needed on case #4421"),
  makeCall("James Porter", "13105559876", "2025-04-01", "09:02", 0, "Missed", ""),
  makeCall("Sandra Lee", "17145553344", "2025-04-01", "09:47", 88, "Call Ended", "Left detailed voicemail"),
  makeCall("Victor Huang", "12135557788", "2025-04-01", "10:33", 475, "Answered", "Requested callback by 5PM"),
  makeCall("Maria Delgado", "13235551212", "2025-04-01", "11:05", 0, "Canceled", ""),
  makeCall("Tony Reyes", "16265550011", "2025-04-01", "11:58", 210, "Answered", ""),
  makeCall("Patricia Wu", "19495554567", "2025-04-01", "13:15", 125, "Voicemail", "Wants renewal info"),
  makeCall("David Kim", "13105551234", "2025-04-01", "14:02", 623, "Answered", "Long call - escalation request"),
  makeCall("Sandra Lee", "17145553344", "2025-04-01", "14:50", 0, "Missed", ""),
  makeCall("James Porter", "13105559876", "2025-04-01", "15:22", 55, "Call Ended", ""),
  makeCall("Alicia Monroe", "14155552233", "2025-04-02", "08:05", 390, "Answered", "New intake call"),
  makeCall("Victor Huang", "12135557788", "2025-04-02", "09:30", 0, "Missed", ""),
  makeCall("Maria Delgado", "13235551212", "2025-04-02", "10:15", 540, "Answered", "Case escalated to supervisor"),
  makeCall("Robert Chase", "18185550099", "2025-04-02", "10:55", 0, "Canceled", ""),
  makeCall("Linda Park", "16265558877", "2025-04-02", "11:40", 180, "Call Ended", "Issue resolved"),
  makeCall("Tony Reyes", "16265550011", "2025-04-02", "13:00", 95, "Voicemail", ""),
  makeCall("David Kim", "13105551234", "2025-04-02", "14:10", 285, "Answered", "Follow-up from previous case"),
  makeCall("Nancy Torres", "17145556655", "2025-04-02", "15:05", 0, "Missed", ""),
  makeCall("James Porter", "13105559876", "2025-04-03", "08:45", 445, "Answered", "Third contact this week"),
  makeCall("Sandra Lee", "17145553344", "2025-04-03", "09:20", 120, "Answered", ""),
  makeCall("Patricia Wu", "19495554567", "2025-04-03", "10:00", 0, "Missed", ""),
  makeCall("Robert Chase", "18185550099", "2025-04-03", "10:48", 760, "Answered", "Longest call this week - complex case"),
  makeCall("Alicia Monroe", "14155552233", "2025-04-03", "11:30", 200, "Call Ended", ""),
  makeCall("Victor Huang", "12135557788", "2025-04-03", "13:25", 310, "Answered", "Needs paperwork sent"),
  makeCall("Maria Delgado", "13235551212", "2025-04-03", "14:40", 0, "Voicemail", "4th contact - urgent"),
  makeCall("Support Outbound", "18005551000", "2025-04-03", "15:10", 185, "Outgoing", "Returned Robert Chase call"),
  makeCall("Tony Reyes", "16265550011", "2025-04-04", "09:05", 430, "Answered", ""),
  makeCall("Linda Park", "16265558877", "2025-04-04", "10:20", 0, "Canceled", ""),
  makeCall("David Kim", "13105551234", "2025-04-04", "11:15", 195, "Call Ended", ""),
  makeCall("Nancy Torres", "17145556655", "2025-04-04", "13:50", 270, "Answered", "Referred to case manager"),
  makeCall("James Porter", "13105559876", "2025-04-04", "14:30", 0, "Missed", ""),
  makeCall("Patricia Wu", "19495554567", "2025-04-04", "15:10", 155, "Voicemail", "Third voicemail left"),
  makeCall("Sandra Lee", "17145553344", "2025-04-05", "09:00", 380, "Answered", ""),
  makeCall("Alicia Monroe", "14155552233", "2025-04-05", "10:35", 0, "Missed", ""),
  makeCall("Robert Chase", "18185550099", "2025-04-05", "11:05", 505, "Answered", "Review scheduled"),
  makeCall("Victor Huang", "12135557788", "2025-04-05", "13:00", 0, "Canceled", ""),
  makeCall("Maria Delgado", "13235551212", "2025-04-05", "14:15", 220, "Call Ended", "Resolved"),
  makeCall("Tony Reyes", "16265550011", "2025-04-05", "15:30", 340, "Answered", ""),
];
