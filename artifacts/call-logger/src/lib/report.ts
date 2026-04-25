import { type StoredCall, type ImportResult } from "./types";
import { formatDuration, formatTimestamp } from "./utils";

interface ReportData {
  calls: StoredCall[];
  lastImport: ImportResult | null;
  date?: string;
}

export function generateDailySummary({ calls, lastImport, date }: ReportData): string {
  const targetDate = date ?? new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const total = calls.length;
  const answered = calls.filter((c) => c.status === "Answered" || c.status === "Call Ended").length;
  const missed = calls.filter((c) => c.status === "Missed").length;
  const canceled = calls.filter((c) => c.status === "Canceled").length;
  const voicemail = calls.filter((c) => c.status === "Voicemail").length;
  const outgoing = calls.filter((c) => c.status === "Outgoing").length;

  const nameCounts: Record<string, number> = {};
  calls.forEach((c) => { nameCounts[c.callerName] = (nameCounts[c.callerName] ?? 0) + 1; });
  const repeatCallers = Object.values(nameCounts).filter((n) => n > 1).length;

  const withDuration = calls.filter((c) => c.durationSeconds > 0);
  const avgSec = withDuration.length
    ? Math.round(withDuration.reduce((a, c) => a + c.durationSeconds, 0) / withDuration.length)
    : 0;
  const longest = calls.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a), calls[0]);

  const hourCounts: Record<number, number> = {};
  calls.forEach((c) => { hourCounts[c.hour] = (hourCounts[c.hour] ?? 0) + 1; });
  const peakEntry = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0];
  const peakHour = peakEntry
    ? `${Number(peakEntry[0]) % 12 || 12}${Number(peakEntry[0]) >= 12 ? "PM" : "AM"} (${peakEntry[1]} calls)`
    : "N/A";

  const followUpTargets = calls
    .filter((c) => c.status === "Missed" || c.status === "Voicemail" || c.status === "Canceled" || c.notes.toLowerCase().includes("follow"))
    .reduce<Record<string, { name: string; number: string; count: number; reasons: Set<string> }>>(
      (acc, c) => {
        const key = c.dedupeKey.split("|")[0] + "|" + c.callerName;
        if (!acc[key]) acc[key] = { name: c.callerName, number: c.maskedNumber, count: 0, reasons: new Set() };
        acc[key].count++;
        acc[key].reasons.add(c.status);
        return acc;
      }, {}
    );

  const followUpList = Object.values(followUpTargets)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Plain-English operator summary
  const summaryParts: string[] = [];
  if (total === 0) {
    summaryParts.push("No calls recorded.");
  } else {
    summaryParts.push(`Total of ${total} call${total !== 1 ? "s" : ""} logged.`);
    if (answered > 0) summaryParts.push(`${answered} were answered or completed.`);
    if (missed + canceled > 0) summaryParts.push(`${missed + canceled} went unanswered (${missed} missed, ${canceled} canceled).`);
    if (voicemail > 0) summaryParts.push(`${voicemail} went to voicemail.`);
    if (outgoing > 0) summaryParts.push(`${outgoing} outgoing call${outgoing !== 1 ? "s" : ""} placed.`);
    if (repeatCallers > 0) summaryParts.push(`${repeatCallers} caller${repeatCallers !== 1 ? "s" : ""} called more than once.`);
    summaryParts.push(`Activity peaked at ${peakHour}.`);
    if (longest) summaryParts.push(`Longest call: ${longest.duration} with ${longest.callerName}.`);
  }

  const followUpLines = followUpList.length
    ? followUpList.map((t, i) =>
        `  ${String(i + 1).padStart(2, "0")}. ${t.name.padEnd(24)} ${t.number.padEnd(18)} [${Array.from(t.reasons).join(", ")}] — ${t.count} contact${t.count !== 1 ? "s" : ""}`
      ).join("\n")
    : "  None.";

  const importLines = lastImport
    ? [
        `Last Import:         ${formatTimestamp(lastImport.timestamp)}`,
        `Last Import Format:  ${lastImport.format}`,
        `New Calls Imported:  ${lastImport.imported}`,
        `Duplicates Skipped:  ${lastImport.skipped}`,
      ].join("\n")
    : "  No imports recorded.";

  return [
    "═══════════════════════════════════════════════════════",
    "  PACIFIC SYSTEMS CALL LOGGER",
    "  DAILY HOTLINE SUMMARY",
    "═══════════════════════════════════════════════════════",
    "",
    `Date:                ${targetDate}`,
    "",
    "── CALL STATS ──────────────────────────────────────────",
    `Total Calls:         ${total}`,
    `Answered / Ended:    ${answered}`,
    `Missed:              ${missed}`,
    `Canceled:            ${canceled}`,
    `Voicemails:          ${voicemail}`,
    `Outgoing:            ${outgoing}`,
    `Repeat Callers:      ${repeatCallers}`,
    `Peak Hour:           ${peakHour}`,
    `Longest Call:        ${longest ? `${longest.duration} — ${longest.callerName}` : "N/A"}`,
    `Average Duration:    ${formatDuration(avgSec)}`,
    "",
    "── IMPORT STATUS ───────────────────────────────────────",
    importLines,
    "",
    "── OPERATOR SUMMARY ────────────────────────────────────",
    summaryParts.join(" "),
    "",
    "── FOLLOW-UP TARGETS ───────────────────────────────────",
    followUpLines,
    "",
    "═══════════════════════════════════════════════════════",
    `  Generated: ${new Date().toLocaleString()}`,
    "═══════════════════════════════════════════════════════",
  ].join("\n");
}

export function generateMasterCSV(calls: StoredCall[]): string {
  const header = "Name,Number,MaskedNumber,Date,Time,Duration,DurationSeconds,Status,Source,Notes,DedupeKey";
  const rows = calls.map((c) => [
    csvEscape(c.callerName),
    csvEscape(c.phoneNumber),
    csvEscape(c.maskedNumber),
    csvEscape(c.date),
    csvEscape(c.time),
    csvEscape(c.duration),
    String(c.durationSeconds),
    csvEscape(c.status),
    csvEscape(c.source),
    csvEscape(c.notes),
    csvEscape(c.dedupeKey),
  ].join(","));
  return [header, ...rows].join("\n");
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
