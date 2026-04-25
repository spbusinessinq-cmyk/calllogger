import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { type StoredCall, type CallStatus, type ImportResult } from "@/lib/types";
import { loadCalls, saveCalls, clearCalls, loadLastImport, saveLastImport, mergeImport } from "@/lib/storage";
import { parseText, toStoredCall, FORMAT_LABELS, type DetectedFormat } from "@/lib/parsers";
import { generateDailySummary, generateMasterCSV } from "@/lib/report";
import { formatDuration, formatTimestamp } from "@/lib/utils";
import { SAMPLE_DATA } from "@/data/sampleData";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  Answered: "#22c55e",
  "Call Ended": "#3b82f6",
  Missed: "#ef4444",
  Canceled: "#f97316",
  Voicemail: "#f59e0b",
  Outgoing: "#8b5cf6",
  Other: "#71717a",
};
const STATUS_TEXT: Record<string, string> = {
  Answered: "text-green-400",
  "Call Ended": "text-blue-400",
  Missed: "text-red-400",
  Canceled: "text-orange-400",
  Voicemail: "text-amber-400",
  Outgoing: "text-violet-400",
  Other: "text-zinc-500",
};
const SOURCE_LABELS: Record<string, string> = {
  sample: "Sample",
  manual: "Manual",
  "standard-csv": "CSV",
  "microsip-csv": "MicroSIP",
  "microsip-ini": "MicroSIP INI",
  "microsip-xml": "MicroSIP XML",
  "callcentric-csv": "Callcentric",
  unknown: "Unknown",
};
const FILTER_STATUSES = ["All", "Answered", "Call Ended", "Missed", "Canceled", "Voicemail", "Outgoing", "Repeat Callers"];

// ──────────────────────────────────────────────
// Small UI components
// ──────────────────────────────────────────────
function MetricCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="border border-zinc-700 bg-zinc-900 p-4 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">{label}</span>
      <span className={`text-3xl font-mono font-bold ${accent ?? "text-white"}`}>{value}</span>
      {sub && <span className="text-[11px] font-mono text-zinc-500">{sub}</span>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string; fill?: string }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-zinc-600 bg-zinc-900 p-2 text-xs font-mono text-zinc-300">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.fill ?? "#fff" }}>{p.name ?? "Value"}: {p.value}</p>
      ))}
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 mb-3 border-b border-zinc-800 pb-1">{title}</p>
      {children}
    </div>
  );
}

function Btn({ onClick, children, variant = "default" }: { onClick?: () => void; children: React.ReactNode; variant?: "default" | "green" | "red" | "amber" | "ghost" }) {
  const cls = {
    default: "bg-zinc-700 hover:bg-zinc-600 text-zinc-200 border-zinc-600",
    green: "bg-green-900 hover:bg-green-800 text-green-300 border-green-700",
    red: "bg-red-950 hover:bg-red-900 text-red-300 border-red-800",
    amber: "bg-amber-950 hover:bg-amber-900 text-amber-300 border-amber-800",
    ghost: "bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border-zinc-700",
  }[variant];
  return (
    <button onClick={onClick} className={`text-[11px] uppercase tracking-widest font-mono px-4 py-2 border transition-colors ${cls}`}>
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────
// Main Dashboard
// ──────────────────────────────────────────────
export default function Dashboard() {
  const [calls, setCalls] = useState<StoredCall[]>(() => {
    const stored = loadCalls();
    return stored.length > 0 ? stored : SAMPLE_DATA;
  });
  const [lastImport, setLastImport] = useState<ImportResult | null>(() => loadLastImport());
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleString());

  // Import state
  const [importText, setImportText] = useState("");
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat | "">("");
  const [previewRows, setPreviewRows] = useState<StoredCall[] | null>(null);
  const [allParsed, setAllParsed] = useState<StoredCall[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importMsgType, setImportMsgType] = useState<"ok" | "warn" | "err">("ok");
  const [isDragOver, setIsDragOver] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Table
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showMasked, setShowMasked] = useState(true);

  // Manual add
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualForm, setManualForm] = useState({ callerName: "", phoneNumber: "", date: "", time: "", durationRaw: "", status: "Answered" as CallStatus, notes: "" });
  const [manualMsg, setManualMsg] = useState("");

  // Clear confirm
  const [clearText, setClearText] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Report
  const [reportText, setReportText] = useState("");
  const [reportCopied, setReportCopied] = useState(false);

  useEffect(() => {
    saveCalls(calls);
  }, [calls]);

  // ── Computed metrics ──
  const metrics = useMemo(() => {
    const total = calls.length;
    const answered = calls.filter((c) => c.status === "Answered" || c.status === "Call Ended").length;
    const missed = calls.filter((c) => c.status === "Missed" || c.status === "Canceled").length;
    const voicemail = calls.filter((c) => c.status === "Voicemail").length;
    const outgoing = calls.filter((c) => c.status === "Outgoing").length;
    const nameCounts: Record<string, { count: number; numbers: Set<string> }> = {};
    calls.forEach((c) => {
      if (!nameCounts[c.callerName]) nameCounts[c.callerName] = { count: 0, numbers: new Set() };
      nameCounts[c.callerName].count++;
      nameCounts[c.callerName].numbers.add(c.phoneNumber);
    });
    const repeatCallers = Object.values(nameCounts).filter((v) => v.count > 1).length;
    const withDuration = calls.filter((c) => c.durationSeconds > 0);
    const avgSec = withDuration.length
      ? Math.round(withDuration.reduce((a, c) => a + c.durationSeconds, 0) / withDuration.length)
      : 0;
    const longest = calls.reduce<StoredCall | null>((a, b) => (!a || b.durationSeconds > a.durationSeconds ? b : a), null);
    const hourCounts: Record<number, number> = {};
    calls.forEach((c) => { hourCounts[c.hour] = (hourCounts[c.hour] ?? 0) + 1; });
    const peakEntry = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0];
    const peakHour = peakEntry
      ? `${Number(peakEntry[0]) % 12 || 12}${Number(peakEntry[0]) >= 12 ? "PM" : "AM"}`
      : "N/A";
    return { total, answered, missed, voicemail, outgoing, repeatCallers, avgSec, longest, peakHour, nameCounts };
  }, [calls]);

  const callsByHour = useMemo(() => {
    const map: Record<number, number> = {};
    for (let h = 7; h <= 18; h++) map[h] = 0;
    calls.forEach((c) => { if (c.hour >= 7 && c.hour <= 18) map[c.hour] = (map[c.hour] ?? 0) + 1; });
    return Object.entries(map).sort(([a], [b]) => Number(a) - Number(b)).map(([h, count]) => ({
      hour: `${Number(h) % 12 || 12}${Number(h) >= 12 ? "pm" : "am"}`, count,
    }));
  }, [calls]);

  const callsByDay = useMemo(() => {
    const map: Record<string, number> = {};
    calls.forEach((c) => { if (c.date) map[c.date] = (map[c.date] ?? 0) + 1; });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => {
      try {
        const d = new Date(date + "T12:00:00");
        return { day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count };
      } catch { return { day: date, count }; }
    });
  }, [calls]);

  const callsByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    calls.forEach((c) => { map[c.status] = (map[c.status] ?? 0) + 1; });
    return Object.entries(map).map(([status, count]) => ({ status, count, fill: STATUS_COLORS[status] ?? "#71717a" }));
  }, [calls]);

  const repeatCallerChart = useMemo(() =>
    Object.entries(metrics.nameCounts)
      .filter(([, v]) => v.count > 1)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 8)
      .map(([name, v]) => ({ name: name.split(" ")[0], count: v.count })),
    [metrics.nameCounts]
  );

  const longestCallsChart = useMemo(() =>
    [...calls].filter((c) => c.durationSeconds > 0)
      .sort((a, b) => b.durationSeconds - a.durationSeconds)
      .slice(0, 8)
      .map((c) => ({ name: c.callerName.split(" ")[0], seconds: c.durationSeconds, label: c.duration })),
    [calls]
  );

  const followUpTargets = useMemo(() => {
    const map: Record<string, { name: string; number: string; reasons: Set<string>; lastTime: string; count: number }> = {};
    calls.filter((c) => c.status === "Missed" || c.status === "Voicemail" || c.status === "Canceled" || c.notes.toLowerCase().includes("follow"))
      .forEach((c) => {
        const key = `${c.phoneNumber}|${c.callerName}`;
        if (!map[key]) map[key] = { name: c.callerName, number: c.maskedNumber, reasons: new Set(), lastTime: `${c.date} ${c.time}`, count: 0 };
        map[key].count++;
        map[key].reasons.add(c.status);
        if (`${c.date} ${c.time}` > map[key].lastTime) map[key].lastTime = `${c.date} ${c.time}`;
      });
    // Also add repeat callers
    Object.entries(metrics.nameCounts).filter(([, v]) => v.count > 1).forEach(([name]) => {
      const last = [...calls].filter((c) => c.callerName === name).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
      if (!last) return;
      const key = `${last.phoneNumber}|${last.callerName}`;
      if (!map[key]) map[key] = { name: last.callerName, number: last.maskedNumber, reasons: new Set(), lastTime: `${last.date} ${last.time}`, count: metrics.nameCounts[name].count };
      map[key].reasons.add("Repeat Caller");
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [calls, metrics.nameCounts]);

  const summary = useMemo(() => {
    const followUpCount = calls.filter((c) => c.status === "Missed" || c.status === "Voicemail" || c.status === "Canceled").length;
    return `Hotline activity peaked at ${metrics.peakHour}. ${followUpCount} call${followUpCount !== 1 ? "s" : ""} need follow-up. ${metrics.repeatCallers} repeat caller${metrics.repeatCallers !== 1 ? "s" : ""} identified. Longest call: ${metrics.longest?.duration ?? "N/A"} (${metrics.longest?.callerName ?? "N/A"}).`;
  }, [metrics]);

  const filtered = useMemo(() => {
    let d = calls;
    if (statusFilter !== "All") {
      if (statusFilter === "Repeat Callers") {
        const repeaters = new Set(Object.entries(metrics.nameCounts).filter(([, v]) => v.count > 1).map(([name]) => name));
        d = d.filter((c) => repeaters.has(c.callerName));
      } else {
        d = d.filter((c) => c.status === statusFilter);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      d = d.filter((c) => c.callerName.toLowerCase().includes(q) || c.notes.toLowerCase().includes(q) || c.phoneNumber.includes(q));
    }
    return d;
  }, [calls, statusFilter, search, metrics.nameCounts]);

  // ── Import helpers ──
  const parseAndPreview = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) { setImportMsg("No content to parse."); setImportMsgType("err"); return; }
    const { rows, errors, format } = parseText(trimmed);
    setDetectedFormat(format);
    setParseErrors(errors);
    setShowErrors(false);
    if (rows.length === 0) {
      setImportMsg(errors[0] ?? "Import failed: no rows detected.");
      setImportMsgType("err");
      setPreviewRows(null);
      setAllParsed(null);
      return;
    }
    const source = format as StoredCall["source"];
    const stored = rows.map((r) => toStoredCall(r, source));
    setAllParsed(stored);
    setPreviewRows(stored.slice(0, 5));
    setImportMsg(`Auto-detected: ${FORMAT_LABELS[format]}. ${rows.length} row${rows.length !== 1 ? "s" : ""} ready. Review preview then confirm.`);
    setImportMsgType("ok");
  }, []);

  const handleFileRead = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setImportText(text);
      parseAndPreview(text);
    };
    reader.readAsText(file);
  }, [parseAndPreview]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileRead(file);
  }, [handleFileRead]);

  const handleConfirmImport = useCallback(() => {
    if (!allParsed) return;
    const { imported, skipped } = mergeImport(allParsed);
    const updated = loadCalls();
    setCalls(updated);
    const result: ImportResult = {
      imported,
      skipped,
      errors: parseErrors.length,
      errorDetails: parseErrors,
      total: updated.length,
      format: FORMAT_LABELS[detectedFormat as DetectedFormat] ?? detectedFormat,
      timestamp: new Date().toISOString(),
    };
    setLastImport(result);
    saveLastImport(result);
    setLastUpdated(new Date().toLocaleString());
    setPreviewRows(null);
    setAllParsed(null);
    setImportText("");
    if (imported === 0) {
      setImportMsg(`No new calls found. All ${skipped} row${skipped !== 1 ? "s" : ""} were already imported.`);
      setImportMsgType("warn");
    } else {
      setImportMsg(`Imported: ${imported} new call${imported !== 1 ? "s" : ""} — Skipped duplicates: ${skipped}${parseErrors.length ? ` — Errors: ${parseErrors.length}` : ""}. Safe Import Enabled.`);
      setImportMsgType("ok");
    }
  }, [allParsed, parseErrors, detectedFormat]);

  const handleSampleData = useCallback(() => {
    setImportText("");
    setPreviewRows(null);
    setAllParsed(null);
    setImportMsg(null);
    const { imported, skipped } = mergeImport(SAMPLE_DATA);
    const updated = loadCalls();
    setCalls(updated);
    const result: ImportResult = {
      imported, skipped, errors: 0, errorDetails: [], total: updated.length,
      format: "Sample Data", timestamp: new Date().toISOString(),
    };
    setLastImport(result);
    saveLastImport(result);
    setLastUpdated(new Date().toLocaleString());
    setImportMsg(`Sample data loaded. Imported: ${imported}, skipped: ${skipped}.`);
    setImportMsgType("ok");
  }, []);

  const handleClearImportBox = useCallback(() => {
    setImportText("");
    setPreviewRows(null);
    setAllParsed(null);
    setImportMsg(null);
    setDetectedFormat("");
    setParseErrors([]);
  }, []);

  // ── Manual add ──
  const handleManualAdd = useCallback(() => {
    const { callerName, phoneNumber, date, time, durationRaw, status, notes } = manualForm;
    let durationSeconds = 0;
    const mMatch = durationRaw.match(/(\d+)m/);
    const sMatch = durationRaw.match(/(\d+)s/);
    if (mMatch) durationSeconds += parseInt(mMatch[1]) * 60;
    if (sMatch) durationSeconds += parseInt(sMatch[1]);
    if (!mMatch && !sMatch && /^\d+$/.test(durationRaw)) durationSeconds = parseInt(durationRaw || "0");

    const newCall = toStoredCall(
      { callerName, phoneNumber, date, time, durationSeconds, status, notes },
      "manual"
    );
    const existing = loadCalls();
    if (existing.some((c) => c.dedupeKey === newCall.dedupeKey)) {
      setManualMsg("This call already exists (duplicate detected).");
      return;
    }
    const updated = [...existing, newCall];
    saveCalls(updated);
    setCalls(updated);
    setLastUpdated(new Date().toLocaleString());
    setManualForm({ callerName: "", phoneNumber: "", date: "", time: "", durationRaw: "", status: "Answered", notes: "" });
    setManualMsg("Call added successfully.");
    setTimeout(() => setManualMsg(""), 3000);
  }, [manualForm]);

  // ── Clear all ──
  const handleClearAll = useCallback(() => {
    if (clearText !== "CLEAR") return;
    clearCalls();
    setCalls([]);
    setLastImport(null);
    setClearText("");
    setShowClearConfirm(false);
    setLastUpdated(new Date().toLocaleString());
  }, [clearText]);

  // ── Export ──
  const handleExportCSV = useCallback(() => {
    const csv = generateMasterCSV(calls);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacific-systems-calls-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [calls]);

  const handleGenerateReport = useCallback(() => {
    const text = generateDailySummary({ calls, lastImport });
    setReportText(text);
  }, [calls, lastImport]);

  const handleCopyReport = useCallback(async () => {
    await navigator.clipboard.writeText(reportText);
    setReportCopied(true);
    setTimeout(() => setReportCopied(false), 2000);
  }, [reportText]);

  const handleDownloadReport = useCallback(() => {
    const blob = new Blob([reportText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacific-systems-summary-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [reportText]);

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono">
      {/* HEADER */}
      <header className="border-b border-zinc-800 px-6 py-4 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-widest uppercase text-white">
            PACIFIC SYSTEMS <span className="text-zinc-500">//</span> CALL LOGGER
          </h1>
          <p className="text-[11px] text-zinc-500 tracking-wide mt-0.5">Hotline call data visualization</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-[10px] text-zinc-600 uppercase tracking-widest">
          <span>Last updated: <span className="text-zinc-400">{lastUpdated}</span></span>
          <span>Data Source: <span className="text-zinc-400">Master Database ({calls.length} calls)</span></span>
          {lastImport && (
            <span>Last Import: <span className="text-zinc-400">{lastImport.format} — {lastImport.imported} in / {lastImport.skipped} skipped</span></span>
          )}
        </div>
      </header>

      <main className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto space-y-8">

        {/* ── IMPORT SECTION ── */}
        <Sec title="Import Call Log">
          <div className="border border-zinc-700 bg-zinc-900 p-5 space-y-4">
            <p className="text-[11px] text-zinc-500">Paste, drag, or upload your MicroSIP / Callcentric export. Formats: Standard CSV, MicroSIP CSV, MicroSIP INI, MicroSIP XML, Callcentric CSV.</p>

            {/* Drag-and-drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-none cursor-pointer flex flex-col items-center justify-center py-8 gap-2 transition-colors ${isDragOver ? "border-blue-500 bg-blue-950/20" : "border-zinc-700 hover:border-zinc-500"}`}
            >
              <span className="text-zinc-400 text-sm">Drop CSV / TXT / INI / XML call log here</span>
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest">or click to choose file</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.ini,.xml"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileRead(f); e.target.value = ""; }}
              />
            </div>

            {/* Paste box */}
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Or paste call log text here</p>
              <textarea
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setPreviewRows(null);
                  setAllParsed(null);
                  setImportMsg(null);
                }}
                rows={5}
                placeholder={`Name,Number,Date,Time,Duration,Status,Notes\nJohn Doe,13235551234,2025-04-01,09:00,5m 30s,Answered,Notes here\n\n--- or MicroSIP INI format ---\n[Calls]\n0=13235551234;John Doe;1;1743460800;330;`}
                className="w-full bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 placeholder-zinc-700 p-3 focus:outline-none focus:border-zinc-500 resize-y"
              />
            </div>

            {/* Format badge */}
            {detectedFormat && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Auto-detected format:</span>
                <span className="text-[10px] border border-blue-700 bg-blue-950/30 text-blue-300 px-2 py-0.5 uppercase tracking-widest">
                  {FORMAT_LABELS[detectedFormat as DetectedFormat] ?? detectedFormat}
                </span>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-2 flex-wrap">
              <Btn onClick={() => parseAndPreview(importText)} variant="default">Import Log</Btn>
              <Btn onClick={handleSampleData} variant="ghost">Use Sample Data</Btn>
              <Btn onClick={handleClearImportBox} variant="ghost">Clear Import Box</Btn>
            </div>

            {/* Import message */}
            {importMsg && (
              <div className={`text-xs font-mono px-3 py-2 border ${
                importMsgType === "ok" ? "border-green-800 bg-green-950/20 text-green-300" :
                importMsgType === "warn" ? "border-amber-800 bg-amber-950/20 text-amber-300" :
                "border-red-800 bg-red-950/20 text-red-300"
              }`}>
                {importMsg}
              </div>
            )}

            {/* Row errors collapsible */}
            {parseErrors.length > 0 && (
              <div>
                <button onClick={() => setShowErrors(!showErrors)} className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-widest">
                  {showErrors ? "▼" : "▶"} {parseErrors.length} row error{parseErrors.length !== 1 ? "s" : ""} — click to {showErrors ? "hide" : "show"}
                </button>
                {showErrors && (
                  <div className="mt-2 border border-zinc-800 bg-zinc-950 p-2 text-[10px] text-red-400 font-mono space-y-0.5 max-h-32 overflow-y-auto">
                    {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
            )}

            {/* Preview */}
            {previewRows && previewRows.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Preview — first {previewRows.length} row{previewRows.length !== 1 ? "s" : ""} of {allParsed?.length ?? 0}</p>
                <div className="overflow-x-auto border border-zinc-700">
                  <table className="w-full text-xs font-mono min-w-[600px]">
                    <thead>
                      <tr className="border-b border-zinc-700 bg-zinc-900">
                        {["Caller", "Masked Number", "Date", "Time", "Duration", "Status"].map((h) => (
                          <th key={h} className="text-left text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i} className="border-b border-zinc-800 bg-zinc-950">
                          <td className="px-3 py-1.5 text-zinc-200">{r.callerName || "—"}</td>
                          <td className="px-3 py-1.5 text-zinc-400">{r.maskedNumber || "—"}</td>
                          <td className="px-3 py-1.5 text-zinc-400">{r.date || "—"}</td>
                          <td className="px-3 py-1.5 text-zinc-400">{r.time || "—"}</td>
                          <td className="px-3 py-1.5 text-zinc-300">{r.duration}</td>
                          <td className={`px-3 py-1.5 ${STATUS_TEXT[r.status] ?? "text-zinc-400"}`}>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <Btn onClick={handleConfirmImport} variant="green">Confirm Import ({allParsed?.length} calls)</Btn>
                </div>
              </div>
            )}
          </div>
        </Sec>

        {/* ── METRICS ── */}
        <Sec title="Overview">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-zinc-800">
            <MetricCard label="Total Calls" value={String(metrics.total)} accent="text-white" />
            <MetricCard label="Answered / Ended" value={String(metrics.answered)} accent="text-green-400" />
            <MetricCard label="Missed / Canceled" value={String(metrics.missed)} accent="text-red-400" />
            <MetricCard label="Voicemails" value={String(metrics.voicemail)} accent="text-amber-400" />
            <MetricCard label="Outgoing" value={String(metrics.outgoing)} accent="text-violet-400" />
            <MetricCard label="Repeat Callers" value={String(metrics.repeatCallers)} accent="text-blue-400" />
            <MetricCard label="Avg Duration" value={formatDuration(metrics.avgSec)} accent="text-zinc-300" />
            <MetricCard label="Peak Hour" value={metrics.peakHour} accent="text-amber-400" />
          </div>
          <div className="mt-3 border border-zinc-800 bg-zinc-900 px-4 py-2">
            <p className="text-[11px] text-zinc-300 leading-relaxed">{summary}</p>
          </div>
        </Sec>

        {/* ── CHARTS ── */}
        <Sec title="Call Volume">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Calls by Hour</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={callsByHour} barCategoryGap="20%">
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" fill="#3b82f6" name="Calls" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Calls by Day</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={callsByDay} barCategoryGap="20%">
                  <XAxis dataKey="day" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" fill="#22c55e" name="Calls" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Sec>

        <Sec title="Status & Callers">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Calls by Status</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={callsByStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} innerRadius={30} stroke="none" paddingAngle={2}>
                    {callsByStatus.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconSize={8} iconType="circle" formatter={(v) => <span style={{ fontSize: 10, fontFamily: "monospace", color: "#a1a1aa" }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Top Repeat Callers</p>
              {repeatCallerChart.length === 0 ? <p className="text-xs text-zinc-600 mt-4">No repeat callers</p> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={repeatCallerChart} layout="vertical" barCategoryGap="20%">
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="count" fill="#8b5cf6" name="Calls" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Longest Calls</p>
              {longestCallsChart.length === 0 ? <p className="text-xs text-zinc-600 mt-4">No calls with duration</p> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={longestCallsChart} layout="vertical" barCategoryGap="20%">
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={(p) => {
                      if (!p.active || !p.payload?.length) return null;
                      const row = longestCallsChart.find((r) => r.name === p.label);
                      return <div className="border border-zinc-600 bg-zinc-900 p-2 text-xs font-mono text-zinc-300"><p className="text-zinc-400">{p.label}</p><p>{row?.label}</p></div>;
                    }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="seconds" fill="#f59e0b" name="Seconds" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Follow-up Targets</p>
              {followUpTargets.length === 0 ? <p className="text-xs text-zinc-600">No follow-up targets</p> : (
                <div className="space-y-1.5 overflow-y-auto max-h-[200px]">
                  {followUpTargets.slice(0, 6).map((t, i) => (
                    <div key={i} className="border border-zinc-800 px-2 py-1.5">
                      <div className="flex justify-between items-start">
                        <span className="text-xs text-zinc-200 truncate max-w-[120px]">{t.name}</span>
                        <span className="text-xs font-bold text-amber-400 ml-2">{t.count}</span>
                      </div>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {Array.from(t.reasons).map((r, j) => (
                          <span key={j} className="text-[9px] border border-zinc-700 text-zinc-500 px-1">{r}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Sec>

        {/* ── FOLLOW-UP TARGETS TABLE ── */}
        {followUpTargets.length > 0 && (
          <Sec title="Follow-up Targets — Detail">
            <div className="overflow-x-auto border border-zinc-700">
              <table className="w-full text-xs font-mono min-w-[600px]">
                <thead>
                  <tr className="border-b border-zinc-700 bg-zinc-900">
                    {["Caller", "Masked Number", "Reason(s)", "Last Contact", "Count"].map((h) => (
                      <th key={h} className="text-left text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {followUpTargets.map((t, i) => (
                    <tr key={i} className={`border-b border-zinc-800 ${i % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/30"}`}>
                      <td className="px-3 py-2 text-zinc-200">{t.name}</td>
                      <td className="px-3 py-2 text-zinc-400">{t.number}</td>
                      <td className="px-3 py-2 text-amber-400">{Array.from(t.reasons).join(", ")}</td>
                      <td className="px-3 py-2 text-zinc-500">{t.lastTime}</td>
                      <td className="px-3 py-2 font-bold text-white">{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sec>
        )}

        {/* ── CALL TABLE ── */}
        <Sec title="Call Log">
          <div className="flex flex-col sm:flex-row gap-3 mb-3 flex-wrap">
            <div className="flex gap-1 flex-wrap">
              {FILTER_STATUSES.map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`text-[10px] px-2 py-1 border uppercase tracking-widest font-mono transition-colors ${statusFilter === s ? "border-zinc-400 text-white bg-zinc-700" : "border-zinc-700 text-zinc-500 hover:border-zinc-500"}`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-2 ml-auto items-center">
              <input type="text" placeholder="Search name, notes, phone..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="text-xs font-mono bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-52" />
              <button onClick={() => setShowMasked(!showMasked)}
                className="text-[10px] px-2 py-1.5 border border-zinc-700 text-zinc-500 hover:border-zinc-500 uppercase tracking-widest font-mono">
                {showMasked ? "Show #" : "Mask #"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto border border-zinc-700">
            <table className="w-full text-xs font-mono min-w-[800px]">
              <thead>
                <tr className="border-b border-zinc-700 bg-zinc-900">
                  {["Caller", "Number", "Date", "Time", "Duration", "Status", "Source", "Notes"].map((h) => (
                    <th key={h} className="text-left text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-600">No records match.</td></tr>
                )}
                {filtered.map((r, i) => (
                  <tr key={i} className={`border-b border-zinc-800 ${i % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/50"} hover:bg-zinc-800/60`}>
                    <td className="px-3 py-2 text-zinc-200">{r.callerName}</td>
                    <td className="px-3 py-2 text-zinc-400 tracking-wide">{showMasked ? r.maskedNumber : r.phoneNumber}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.date}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.time}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.duration}</td>
                    <td className={`px-3 py-2 ${STATUS_TEXT[r.status] ?? "text-zinc-400"}`}>{r.status}</td>
                    <td className="px-3 py-2 text-zinc-600 text-[10px]">{SOURCE_LABELS[r.source] ?? r.source}</td>
                    <td className="px-3 py-2 text-zinc-500 max-w-[200px] truncate">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-zinc-600 mt-2">{filtered.length} record{filtered.length !== 1 ? "s" : ""} shown of {calls.length} total</p>
        </Sec>

        {/* ── MANUAL ADD ── */}
        <Sec title="Add Call Manually">
          <div className="border border-zinc-700 bg-zinc-900 p-5">
            <button onClick={() => setShowManualAdd(!showManualAdd)} className="text-[11px] uppercase tracking-widest font-mono text-zinc-400 hover:text-zinc-200 mb-3 flex items-center gap-2">
              <span>{showManualAdd ? "▼" : "▶"}</span> {showManualAdd ? "Hide" : "Show"} Manual Entry Form
            </button>
            {showManualAdd && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { label: "Caller Name", key: "callerName", placeholder: "e.g. Maria Delgado" },
                  { label: "Phone Number", key: "phoneNumber", placeholder: "e.g. 13235551212" },
                  { label: "Date", key: "date", placeholder: "2025-04-01" },
                  { label: "Time", key: "time", placeholder: "09:30" },
                  { label: "Duration", key: "durationRaw", placeholder: "5m 30s or 330" },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">{label}</p>
                    <input type="text" value={manualForm[key as keyof typeof manualForm] as string}
                      onChange={(e) => setManualForm({ ...manualForm, [key]: e.target.value })}
                      placeholder={placeholder}
                      className="w-full bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 placeholder-zinc-700 px-3 py-2 focus:outline-none focus:border-zinc-500" />
                  </div>
                ))}
                <div>
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Status</p>
                  <select value={manualForm.status} onChange={(e) => setManualForm({ ...manualForm, status: e.target.value as CallStatus })}
                    className="w-full bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 px-3 py-2 focus:outline-none focus:border-zinc-500">
                    {["Answered", "Call Ended", "Missed", "Canceled", "Voicemail", "Outgoing", "Other"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-3">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Notes</p>
                  <input type="text" value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                    placeholder="Optional notes"
                    className="w-full bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 placeholder-zinc-700 px-3 py-2 focus:outline-none focus:border-zinc-500" />
                </div>
                <div className="lg:col-span-3 flex items-center gap-3">
                  <Btn onClick={handleManualAdd} variant="green">Add Call</Btn>
                  {manualMsg && <span className={`text-xs font-mono ${manualMsg.includes("already") ? "text-red-400" : "text-green-400"}`}>{manualMsg}</span>}
                </div>
              </div>
            )}
          </div>
        </Sec>

        {/* ── EXPORT & REPORT ── */}
        <Sec title="Export & Reports">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Export CSV + Clear */}
            <div className="border border-zinc-700 bg-zinc-900 p-5 space-y-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Master Database</p>
              <div className="flex gap-2 flex-wrap">
                <Btn onClick={handleExportCSV} variant="default">Export Master CSV</Btn>
                <Btn onClick={() => setShowClearConfirm(!showClearConfirm)} variant="red">Clear All Calls</Btn>
              </div>
              {showClearConfirm && (
                <div className="border border-red-900 bg-red-950/20 p-3 space-y-2">
                  <p className="text-xs text-red-300">This will permanently delete all {calls.length} stored calls. Type CLEAR to confirm.</p>
                  <input type="text" value={clearText} onChange={(e) => setClearText(e.target.value)}
                    placeholder="Type CLEAR to confirm"
                    className="bg-zinc-950 border border-red-800 text-xs font-mono text-zinc-300 placeholder-zinc-700 px-3 py-2 focus:outline-none w-full" />
                  <div className="flex gap-2">
                    <Btn onClick={handleClearAll} variant="red">Confirm Delete</Btn>
                    <Btn onClick={() => { setShowClearConfirm(false); setClearText(""); }} variant="ghost">Cancel</Btn>
                  </div>
                </div>
              )}
            </div>

            {/* Daily Summary */}
            <div className="border border-zinc-700 bg-zinc-900 p-5 space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Daily Summary Report</p>
              <Btn onClick={handleGenerateReport} variant="amber">Generate Daily Summary</Btn>
              {reportText && (
                <>
                  <pre className="text-[10px] font-mono text-zinc-400 bg-zinc-950 border border-zinc-800 p-3 overflow-auto max-h-48 whitespace-pre">{reportText}</pre>
                  <div className="flex gap-2">
                    <Btn onClick={handleCopyReport} variant="default">{reportCopied ? "Copied!" : "Copy Report"}</Btn>
                    <Btn onClick={handleDownloadReport} variant="ghost">Download TXT</Btn>
                  </div>
                </>
              )}
            </div>
          </div>
        </Sec>

      </main>

      <footer className="border-t border-zinc-800 px-6 py-3 mt-4">
        <p className="text-[10px] text-zinc-700 uppercase tracking-widest">Pacific Systems // Call Logger — All data processed locally. No login required.</p>
      </footer>
    </div>
  );
}
