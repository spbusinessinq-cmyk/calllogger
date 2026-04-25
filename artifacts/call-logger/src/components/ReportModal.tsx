import { useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { type StoredCall, type ImportResult } from "@/lib/types";
import { formatDuration, formatTimestamp } from "@/lib/utils";
import { generateDailySummary } from "@/lib/report";
import { generateHtmlReport } from "@/lib/htmlReport";

const STATUS_COLORS: Record<string, string> = {
  Answered: "#22c55e",
  "Call Ended": "#3b82f6",
  Missed: "#ef4444",
  Canceled: "#f97316",
  Voicemail: "#f59e0b",
  Outgoing: "#8b5cf6",
  Other: "#71717a",
};

interface Props {
  calls: StoredCall[];
  lastImport: ImportResult | null;
  onClose: () => void;
}

export default function ReportModal({ calls, lastImport, onClose }: Props) {
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

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
  const peakEntry = Object.entries(hourMap).sort(([, a], [, b]) => b - a)[0];
  const peakHour = peakEntry ? `${Number(peakEntry[0]) % 12 || 12}${Number(peakEntry[0]) >= 12 ? "PM" : "AM"}` : "N/A";

  const hourData = Object.entries(hourMap).sort(([a], [b]) => Number(a) - Number(b)).map(([h, count]) => ({
    hour: `${Number(h) % 12 || 12}${Number(h) >= 12 ? "p" : "a"}`,
    count,
  }));

  const statusMap: Record<string, number> = {};
  calls.forEach((c) => { statusMap[c.status] = (statusMap[c.status] ?? 0) + 1; });
  const statusData = Object.entries(statusMap).map(([status, count]) => ({
    status, count, fill: STATUS_COLORS[status] ?? "#71717a",
  }));

  const followUpMap: Record<string, { name: string; number: string; reasons: Set<string>; count: number }> = {};
  calls.filter((c) => c.status === "Missed" || c.status === "Voicemail" || c.status === "Canceled")
    .forEach((c) => {
      const key = `${c.phoneNumber}|${c.callerName}`;
      if (!followUpMap[key]) followUpMap[key] = { name: c.callerName, number: c.maskedNumber, reasons: new Set(), count: 0 };
      followUpMap[key].count++;
      followUpMap[key].reasons.add(c.status);
    });
  const followUpList = Object.values(followUpMap).sort((a, b) => b.count - a.count).slice(0, 10);

  const summaryParts: string[] = [];
  if (total === 0) {
    summaryParts.push("No calls recorded.");
  } else {
    summaryParts.push(`Total of ${total} call${total !== 1 ? "s" : ""} logged.`);
    if (answered > 0) summaryParts.push(`${answered} answered or completed.`);
    if (missed + canceled > 0) summaryParts.push(`${missed + canceled} unanswered (${missed} missed, ${canceled} canceled).`);
    if (voicemail > 0) summaryParts.push(`${voicemail} went to voicemail.`);
    if (outgoing > 0) summaryParts.push(`${outgoing} outgoing.`);
    if (repeatCallers > 0) summaryParts.push(`${repeatCallers} repeat caller${repeatCallers !== 1 ? "s" : ""}.`);
    summaryParts.push(`Activity peaked at ${peakHour}.`);
    if (longest) summaryParts.push(`Longest call: ${longest.duration} (${longest.callerName}).`);
  }

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const handlePrint = () => window.print();

  const handleDownloadHtml = () => {
    const html = generateHtmlReport(calls, lastImport);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacific-systems-report-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTxt = () => {
    const txt = generateDailySummary({ calls, lastImport });
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacific-systems-summary-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopySummary = async () => {
    await navigator.clipboard.writeText(summaryParts.join(" "));
  };

  const tooltipStyle = { border: "1px solid #374151", backgroundColor: "#111827", fontSize: 10, fontFamily: "monospace", color: "#d1d5db" };

  return (
    <>
      {/* Print-only styles injected via style tag */}
      <style>{`
        @media print {
          body > *:not(#report-modal-root) { display: none !important; }
          #report-modal-root { position: static !important; background: white !important; padding: 0 !important; }
          .report-modal-overlay { background: white !important; padding: 0 !important; }
          .report-modal-actions { display: none !important; }
          .report-modal-close { display: none !important; }
          .report-modal-doc {
            max-width: 100% !important;
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            color: black !important;
            background: white !important;
          }
          .report-modal-doc * { color: black !important; border-color: #d1d5db !important; }
          .report-stat-value { color: black !important; }
          @page { size: letter; margin: 0.4in; }
        }
      `}</style>

      <div id="report-modal-root" className="fixed inset-0 z-50 report-modal-overlay bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
        {/* Action buttons - outside print area */}
        <div className="report-modal-actions fixed top-4 right-4 z-50 flex gap-2 flex-wrap justify-end no-print">
          <button onClick={handlePrint} className="text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white border border-zinc-600">Print / Save PDF</button>
          <button onClick={handleDownloadHtml} className="text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white border border-zinc-600">Download HTML</button>
          <button onClick={handleDownloadTxt} className="text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white border border-zinc-600">Download TXT</button>
          <button onClick={handleCopySummary} className="text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white border border-zinc-600">Copy Summary</button>
          <button onClick={onClose} className="report-modal-close text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-700">✕ Close</button>
        </div>

        {/* Report document */}
        <div ref={reportRef} className="report-modal-doc bg-white text-black font-mono w-full max-w-4xl border border-zinc-300 p-8 mt-14 print:mt-0">

          {/* Header */}
          <div className="border-b-2 border-black pb-3 mb-5">
            <h1 className="text-base font-bold tracking-widest uppercase">Pacific Systems Call Logger</h1>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mt-0.5">Daily Call Activity Report</p>
            <p className="text-[10px] text-zinc-500 mt-1">{today}</p>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-4 gap-2 mb-5">
            {[
              { label: "Total Calls", value: String(total), color: "text-black" },
              { label: "Answered / Ended", value: String(answered), color: "text-green-700" },
              { label: "Missed / Canceled", value: String(missed + canceled), color: "text-red-700" },
              { label: "Voicemails", value: String(voicemail), color: "text-amber-700" },
              { label: "Outgoing", value: String(outgoing), color: "text-violet-700" },
              { label: "Repeat Callers", value: String(repeatCallers), color: "text-blue-700" },
              { label: "Avg Duration", value: formatDuration(avgSec), color: "text-black" },
              { label: "Peak Hour", value: peakHour, color: "text-amber-700" },
            ].map(({ label, value, color }) => (
              <div key={label} className="border border-zinc-300 p-2">
                <div className="text-[8px] uppercase tracking-widest text-zinc-500">{label}</div>
                <div className={`report-stat-value text-xl font-bold leading-tight mt-0.5 ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className="border border-zinc-300 p-3">
              <p className="text-[8px] uppercase tracking-widest text-zinc-500 mb-2">Calls by Hour</p>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={hourData} barCategoryGap="15%">
                  <XAxis dataKey="hour" tick={{ fontSize: 8, fontFamily: "monospace", fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 8, fontFamily: "monospace", fill: "#6b7280" }} axisLine={false} tickLine={false} width={18} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                  <Bar dataKey="count" fill="#3b82f6" name="Calls" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="border border-zinc-300 p-3">
              <p className="text-[8px] uppercase tracking-widest text-zinc-500 mb-2">Calls by Status</p>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={statusData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={50} innerRadius={20} stroke="none" paddingAngle={2}>
                    {statusData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {statusData.map((d) => (
                  <div key={d.status} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                    <span className="text-[8px] text-zinc-600">{d.status} ({d.count})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Summary + Follow-up */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="border border-zinc-300 p-3">
              <p className="text-[8px] uppercase tracking-widest text-zinc-500 mb-2">Operator Summary</p>
              <p className="text-[10px] leading-relaxed text-zinc-700">{summaryParts.join(" ")}</p>
              {lastImport && (
                <div className="mt-3 pt-2 border-t border-zinc-200 text-[9px] text-zinc-500 space-y-0.5">
                  <div>Last Import: {formatTimestamp(lastImport.timestamp)}</div>
                  <div>Format: {lastImport.format} — {lastImport.imported} imported / {lastImport.skipped} skipped</div>
                </div>
              )}
            </div>
            <div className="border border-zinc-300 p-3">
              <p className="text-[8px] uppercase tracking-widest text-zinc-500 mb-2">Follow-up Targets</p>
              {followUpList.length === 0 ? (
                <p className="text-[10px] text-zinc-500">No follow-up targets.</p>
              ) : (
                <div className="space-y-1">
                  {followUpList.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-[9px] border-b border-zinc-100 pb-0.5">
                      <span className="font-medium text-zinc-800">{t.name}</span>
                      <span className="text-zinc-500">{t.number}</span>
                      <span className="text-zinc-600">{Array.from(t.reasons).join(", ")}</span>
                      <span className="font-bold text-red-700">{t.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-zinc-300 pt-2 flex justify-between text-[9px] text-zinc-400">
            <span>PACIFIC SYSTEMS // CALL LOGGER — CONFIDENTIAL</span>
            <span>Generated: {new Date().toLocaleString()}</span>
          </div>
        </div>
      </div>
    </>
  );
}
