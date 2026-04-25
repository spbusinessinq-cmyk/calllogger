import { type StoredCall, type ImportResult } from "./types";
import { formatDuration, formatTimestamp } from "./utils";

interface Stats {
  total: number;
  answered: number;
  missed: number;
  canceled: number;
  voicemail: number;
  outgoing: number;
  repeatCallers: number;
  avgSec: number;
  peakHour: string;
  longestName: string;
  longestDur: string;
  summary: string;
  followUpList: Array<{ name: string; number: string; reasons: string; count: number }>;
  hourData: Array<{ label: string; count: number }>;
  statusData: Array<{ status: string; count: number; color: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  Answered: "#22c55e",
  "Call Ended": "#3b82f6",
  Missed: "#ef4444",
  Canceled: "#f97316",
  Voicemail: "#f59e0b",
  Outgoing: "#8b5cf6",
  Other: "#71717a",
};

function computeStats(calls: StoredCall[], lastImport: ImportResult | null): Stats {
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

  const longest = calls.reduce<StoredCall | null>((a, b) => (!a || b.durationSeconds > a.durationSeconds ? b : a), null);

  const hourMap: Record<number, number> = {};
  for (let h = 7; h <= 18; h++) hourMap[h] = 0;
  calls.forEach((c) => { if (c.hour >= 7 && c.hour <= 18) hourMap[c.hour] = (hourMap[c.hour] ?? 0) + 1; });
  const hourData = Object.entries(hourMap).sort(([a], [b]) => Number(a) - Number(b)).map(([h, count]) => ({
    label: `${Number(h) % 12 || 12}${Number(h) >= 12 ? "p" : "a"}`,
    count,
  }));

  const peakEntry = Object.entries(hourMap).sort(([, a], [, b]) => b - a)[0];
  const peakHour = peakEntry
    ? `${Number(peakEntry[0]) % 12 || 12}${Number(peakEntry[0]) >= 12 ? "PM" : "AM"}`
    : "N/A";

  const statusMap: Record<string, number> = {};
  calls.forEach((c) => { statusMap[c.status] = (statusMap[c.status] ?? 0) + 1; });
  const statusData = Object.entries(statusMap).map(([status, count]) => ({
    status, count, color: STATUS_COLORS[status] ?? "#71717a",
  }));

  const followUpMap: Record<string, { name: string; number: string; reasons: Set<string>; count: number }> = {};
  calls.filter((c) => c.status === "Missed" || c.status === "Voicemail" || c.status === "Canceled")
    .forEach((c) => {
      const key = `${c.phoneNumber}|${c.callerName}`;
      if (!followUpMap[key]) followUpMap[key] = { name: c.callerName, number: c.maskedNumber, reasons: new Set(), count: 0 };
      followUpMap[key].count++;
      followUpMap[key].reasons.add(c.status);
    });
  const followUpList = Object.values(followUpMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((t) => ({ name: t.name, number: t.number, reasons: Array.from(t.reasons).join(", "), count: t.count }));

  const summaryParts: string[] = [];
  if (total === 0) {
    summaryParts.push("No calls recorded.");
  } else {
    summaryParts.push(`Total of ${total} call${total !== 1 ? "s" : ""} logged.`);
    if (answered > 0) summaryParts.push(`${answered} answered or completed.`);
    if (missed + canceled > 0) summaryParts.push(`${missed + canceled} unanswered (${missed} missed, ${canceled} canceled).`);
    if (voicemail > 0) summaryParts.push(`${voicemail} to voicemail.`);
    if (outgoing > 0) summaryParts.push(`${outgoing} outgoing.`);
    if (repeatCallers > 0) summaryParts.push(`${repeatCallers} repeat caller${repeatCallers !== 1 ? "s" : ""}.`);
    summaryParts.push(`Peak activity at ${peakHour}.`);
    if (longest) summaryParts.push(`Longest call: ${longest.duration} (${longest.callerName}).`);
  }

  return {
    total, answered, missed, canceled, voicemail, outgoing, repeatCallers, avgSec,
    peakHour, longestName: longest?.callerName ?? "N/A", longestDur: longest?.duration ?? "N/A",
    summary: summaryParts.join(" "),
    followUpList, hourData, statusData,
  };
}

export function generateHtmlReport(calls: StoredCall[], lastImport: ImportResult | null): string {
  const s = computeStats(calls, lastImport);
  const now = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const maxHour = Math.max(...s.hourData.map((d) => d.count), 1);
  const maxStatus = Math.max(...s.statusData.map((d) => d.count), 1);

  const hourBars = s.hourData.map((d) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
      <span style="font-size:9px;color:#666;width:28px;text-align:right;">${d.label}</span>
      <div style="flex:1;background:#e5e7eb;height:12px;position:relative;">
        <div style="background:#3b82f6;height:100%;width:${Math.round((d.count / maxHour) * 100)}%;"></div>
      </div>
      <span style="font-size:9px;color:#666;width:16px;">${d.count}</span>
    </div>`).join("");

  const statusBars = s.statusData.map((d) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
      <span style="font-size:9px;color:#444;width:72px;text-align:right;white-space:nowrap;">${d.status}</span>
      <div style="flex:1;background:#e5e7eb;height:12px;">
        <div style="background:${d.color};height:100%;width:${Math.round((d.count / maxStatus) * 100)}%;"></div>
      </div>
      <span style="font-size:9px;color:#666;width:16px;">${d.count}</span>
    </div>`).join("");

  const followUpRows = s.followUpList.length
    ? s.followUpList.map((t, i) => `
      <tr>
        <td style="padding:3px 8px;font-size:10px;">${i + 1}.</td>
        <td style="padding:3px 8px;font-size:10px;">${esc(t.name)}</td>
        <td style="padding:3px 8px;font-size:10px;color:#999;">${esc(t.number)}</td>
        <td style="padding:3px 8px;font-size:10px;">${esc(t.reasons)}</td>
        <td style="padding:3px 8px;font-size:10px;font-weight:bold;">${t.count}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" style="padding:6px 8px;font-size:10px;color:#999;">No follow-up targets.</td></tr>`;

  const importBlock = lastImport
    ? `<div><b>Last Import:</b> ${esc(formatTimestamp(lastImport.timestamp))}</div>
       <div><b>Format:</b> ${esc(lastImport.format)}</div>
       <div><b>Imported:</b> ${lastImport.imported} &nbsp; <b>Skipped:</b> ${lastImport.skipped}</div>`
    : `<div style="color:#999;">No imports recorded.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pacific Systems — Call Activity Report</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 11px; color: #1a1a1a; background: #fff; padding: 0.4in; max-width: 8.5in; margin: 0 auto; }
  h1 { font-size: 16px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
  h2 { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: #555; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 8px; }
  .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 14px; }
  .sub { font-size: 10px; color: #666; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .box { border: 1px solid #d1d5db; padding: 8px 10px; }
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .stat { border: 1px solid #d1d5db; padding: 6px 8px; }
  .stat-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #777; }
  .stat-value { font-size: 22px; font-weight: 600; line-height: 1.1; margin-top: 1px; }
  .stat-sub { font-size: 9px; color: #666; margin-top: 1px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: #777; padding: 3px 8px; border-bottom: 1px solid #e5e7eb; }
  .summary-text { font-size: 10px; line-height: 1.6; color: #333; }
  .footer { margin-top: 14px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 9px; color: #999; display: flex; justify-content: space-between; }
  @media print {
    @page { size: letter; margin: 0.4in; }
    body { padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>Pacific Systems Call Logger</h1>
  <div class="sub">Daily Call Activity Report &nbsp;·&nbsp; ${esc(now)}</div>
</div>

<div class="stat-grid">
  <div class="stat"><div class="stat-label">Total Calls</div><div class="stat-value">${s.total}</div></div>
  <div class="stat"><div class="stat-label">Answered / Ended</div><div class="stat-value" style="color:#16a34a;">${s.answered}</div></div>
  <div class="stat"><div class="stat-label">Missed / Canceled</div><div class="stat-value" style="color:#dc2626;">${s.missed + s.canceled}</div></div>
  <div class="stat"><div class="stat-label">Voicemails</div><div class="stat-value" style="color:#d97706;">${s.voicemail}</div></div>
  <div class="stat"><div class="stat-label">Outgoing</div><div class="stat-value" style="color:#7c3aed;">${s.outgoing}</div></div>
  <div class="stat"><div class="stat-label">Repeat Callers</div><div class="stat-value" style="color:#2563eb;">${s.repeatCallers}</div></div>
  <div class="stat"><div class="stat-label">Avg Duration</div><div class="stat-value" style="font-size:16px;">${esc(formatDuration(s.avgSec))}</div></div>
  <div class="stat"><div class="stat-label">Peak Hour</div><div class="stat-value" style="font-size:16px;color:#d97706;">${esc(s.peakHour)}</div></div>
</div>

<div class="grid2">
  <div class="box">
    <h2>Calls by Hour</h2>
    ${hourBars}
  </div>
  <div class="box">
    <h2>Calls by Status</h2>
    ${statusBars}
  </div>
</div>

<div class="grid2">
  <div class="box">
    <h2>Operator Summary</h2>
    <p class="summary-text">${esc(s.summary)}</p>
    <div style="margin-top:8px;font-size:9px;color:#666;">${importBlock}</div>
  </div>
  <div class="box">
    <h2>Follow-up Targets</h2>
    <table>
      <thead><tr><th>#</th><th>Caller</th><th>Number</th><th>Reason</th><th>Ct</th></tr></thead>
      <tbody>${followUpRows}</tbody>
    </table>
  </div>
</div>

<div class="footer">
  <span>PACIFIC SYSTEMS // CALL LOGGER</span>
  <span>Generated: ${esc(new Date().toLocaleString())}</span>
  <span>Data: ${s.total} calls stored locally</span>
</div>
</body>
</html>`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
