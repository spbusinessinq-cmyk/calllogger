import { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { type StoredCall, type CallStatus, type ImportResult } from "@/lib/types";
import { loadCalls, saveCalls, clearCalls, loadLastImport, saveLastImport, mergeImport } from "@/lib/storage";
import { parseText, toStoredCall, FORMAT_LABELS, type DetectedFormat } from "@/lib/parsers";
import { generateMasterCSV } from "@/lib/report";
import { formatDuration, formatTimestamp } from "@/lib/utils";
import { SAMPLE_DATA } from "@/data/sampleData";

const ReportModal = lazy(() => import("@/components/ReportModal"));

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  Answered: "#22c55e", "Call Ended": "#3b82f6", Missed: "#ef4444",
  Canceled: "#f97316", Voicemail: "#f59e0b", Outgoing: "#8b5cf6", Other: "#71717a",
};
const STATUS_TEXT: Record<string, string> = {
  Answered: "text-green-400", "Call Ended": "text-blue-400", Missed: "text-red-400",
  Canceled: "text-orange-400", Voicemail: "text-amber-400", Outgoing: "text-violet-400", Other: "text-zinc-500",
};
const SOURCE_LABELS: Record<string, string> = {
  sample: "Sample", manual: "Manual", "standard-csv": "CSV",
  "microsip-csv": "MicroSIP", "microsip-ini": "MicroSIP INI",
  "microsip-xml": "MicroSIP XML", "callcentric-csv": "Callcentric", unknown: "Unknown",
};
const FILTER_STATUSES = ["All", "Answered", "Call Ended", "Missed", "Canceled", "Voicemail", "Outgoing", "Repeat Callers"];

// ──────────────────────────────────────────────
// UI primitives
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
function CT({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string; fill?: string }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-zinc-600 bg-zinc-900 p-2 text-xs font-mono text-zinc-300">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} style={{ color: p.fill ?? "#fff" }}>{p.name ?? "Value"}: {p.value}</p>)}
    </div>
  );
}
function Sec({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between border-b border-zinc-800 pb-1 mb-3">
        <p className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}
function Btn({ onClick, children, variant = "default", disabled, small }: {
  onClick?: () => void; children: React.ReactNode;
  variant?: "default" | "green" | "red" | "amber" | "blue" | "ghost";
  disabled?: boolean; small?: boolean;
}) {
  const cls = {
    default: "bg-zinc-700 hover:bg-zinc-600 text-zinc-200 border-zinc-600",
    green: "bg-green-900 hover:bg-green-800 text-green-300 border-green-700",
    red: "bg-red-950 hover:bg-red-900 text-red-300 border-red-800",
    amber: "bg-amber-950 hover:bg-amber-900 text-amber-300 border-amber-800",
    blue: "bg-blue-900 hover:bg-blue-800 text-blue-200 border-blue-700",
    ghost: "bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border-zinc-700",
  }[variant];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${small ? "text-[10px] px-3 py-1" : "text-[11px] px-4 py-2"} uppercase tracking-widest font-mono border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}>
      {children}
    </button>
  );
}
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-[160px] border border-dashed border-zinc-800">
      <p className="text-[10px] text-zinc-700 uppercase tracking-widest">{label}</p>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Dashboard
// ──────────────────────────────────────────────
export default function Dashboard() {
  // ── Core state
  const [calls, setCalls] = useState<StoredCall[]>(() => loadCalls());
  const [lastImport, setLastImport] = useState<ImportResult | null>(() => loadLastImport());
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleString());

  useEffect(() => { saveCalls(calls); }, [calls]);

  // ── Import state
  const [importOpen, setImportOpen] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [importText, setImportText] = useState("");
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat | "">("");
  const [previewRows, setPreviewRows] = useState<StoredCall[] | null>(null);
  const [allParsed, setAllParsed] = useState<StoredCall[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importMsg, setImportMsg] = useState<{ text: string; type: "ok" | "warn" | "err" } | null>(null);
  const [statusDebug, setStatusDebug] = useState<Record<string, number> | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // ── Table state
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showMasked, setShowMasked] = useState(true);

  // ── Manual add
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualForm, setManualForm] = useState({ callerName: "", phoneNumber: "", date: "", time: "", durationRaw: "", status: "Answered" as CallStatus, notes: "" });
  const [manualMsg, setManualMsg] = useState("");

  // ── Clear confirm
  const [clearText, setClearText] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // ── Report modal
  const [showReport, setShowReport] = useState(false);

  // ── Dev tools
  const [showDevTools, setShowDevTools] = useState(false);

  // ──────────────────────────────────────────────
  // Derived data
  // ──────────────────────────────────────────────
  const metrics = useMemo(() => {
    const total = calls.length;
    const answered = calls.filter((c) => c.status === "Answered" || c.status === "Call Ended").length;
    const missed = calls.filter((c) => c.status === "Missed" || c.status === "Canceled").length;
    const voicemail = calls.filter((c) => c.status === "Voicemail").length;
    const outgoing = calls.filter((c) => c.status === "Outgoing").length;
    const nameCounts: Record<string, { count: number }> = {};
    calls.forEach((c) => { if (!nameCounts[c.callerName]) nameCounts[c.callerName] = { count: 0 }; nameCounts[c.callerName].count++; });
    const repeatCallers = Object.values(nameCounts).filter((v) => v.count > 1).length;
    const withDur = calls.filter((c) => c.durationSeconds > 0);
    const avgSec = withDur.length ? Math.round(withDur.reduce((a, c) => a + c.durationSeconds, 0) / withDur.length) : 0;
    const longest = calls.reduce<StoredCall | null>((a, b) => (!a || b.durationSeconds > a.durationSeconds ? b : a), null);
    const hourCounts: Record<number, number> = {};
    calls.forEach((c) => { hourCounts[c.hour] = (hourCounts[c.hour] ?? 0) + 1; });
    const peakEntry = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0];
    const peakHour = peakEntry ? `${Number(peakEntry[0]) % 12 || 12}${Number(peakEntry[0]) >= 12 ? "PM" : "AM"}` : "—";
    return { total, answered, missed, voicemail, outgoing, repeatCallers, avgSec, longest, peakHour, nameCounts };
  }, [calls]);

  const callsByHour = useMemo(() => {
    const map: Record<number, number> = {};
    for (let h = 7; h <= 18; h++) map[h] = 0;
    calls.forEach((c) => { if (c.hour >= 7 && c.hour <= 18) map[c.hour] = (map[c.hour] ?? 0) + 1; });
    return Object.entries(map).sort(([a], [b]) => Number(a) - Number(b)).map(([h, count]) => ({
      hour: `${Number(h) % 12 || 12}${Number(h) >= 12 ? "p" : "a"}`, count,
    }));
  }, [calls]);

  const callsByDay = useMemo(() => {
    const map: Record<string, number> = {};
    calls.forEach((c) => { if (c.date) map[c.date] = (map[c.date] ?? 0) + 1; });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => {
      try { const d = new Date(date + "T12:00:00"); return { day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count }; }
      catch { return { day: date, count }; }
    });
  }, [calls]);

  const callsByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    calls.forEach((c) => { map[c.status] = (map[c.status] ?? 0) + 1; });
    return Object.entries(map).map(([status, count]) => ({ status, count, fill: STATUS_COLORS[status] ?? "#71717a" }));
  }, [calls]);

  const repeatCallerChart = useMemo(() =>
    Object.entries(metrics.nameCounts).filter(([, v]) => v.count > 1)
      .sort(([, a], [, b]) => b.count - a.count).slice(0, 8)
      .map(([name, v]) => ({ name: name.split(" ")[0], count: v.count })),
    [metrics.nameCounts]
  );

  const longestChart = useMemo(() =>
    [...calls].filter((c) => c.durationSeconds > 0).sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 8)
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
    Object.entries(metrics.nameCounts).filter(([, v]) => v.count > 1).forEach(([name]) => {
      const last = [...calls].filter((c) => c.callerName === name).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
      if (!last) return;
      const key = `${last.phoneNumber}|${last.callerName}`;
      if (!map[key]) map[key] = { name: last.callerName, number: last.maskedNumber, reasons: new Set(), lastTime: `${last.date} ${last.time}`, count: metrics.nameCounts[name].count };
      map[key].reasons.add("Repeat Caller");
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [calls, metrics.nameCounts]);

  const filtered = useMemo(() => {
    let d = calls;
    if (statusFilter !== "All") {
      if (statusFilter === "Repeat Callers") {
        const rep = new Set(Object.entries(metrics.nameCounts).filter(([, v]) => v.count > 1).map(([n]) => n));
        d = d.filter((c) => rep.has(c.callerName));
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

  // ──────────────────────────────────────────────
  // Import handlers
  // ──────────────────────────────────────────────
  const doParseAndPreview = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) { setImportMsg({ text: "No content to parse.", type: "err" }); return; }
    const { rows, errors, format } = parseText(trimmed);
    setDetectedFormat(format);
    setParseErrors(errors);
    setShowErrors(false);
    if (rows.length === 0) {
      setImportMsg({ text: errors[0] ?? "Import failed: no rows detected.", type: "err" });
      setPreviewRows(null); setAllParsed(null); setStatusDebug(null); return;
    }
    const stored = rows.map((r) => toStoredCall(r, format as StoredCall["source"]));
    setAllParsed(stored);
    setPreviewRows(stored.slice(0, 5));
    // Compute per-status breakdown for debug display
    const counts: Record<string, number> = {};
    stored.forEach((c) => { counts[c.status] = (counts[c.status] ?? 0) + 1; });
    setStatusDebug(counts);
    setImportMsg({ text: `Auto-detected: ${FORMAT_LABELS[format]}. ${rows.length} row${rows.length !== 1 ? "s" : ""} ready — review preview below.`, type: "ok" });
  }, []);

  const handleFileRead = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => { const text = e.target?.result as string; setImportText(text); doParseAndPreview(text); };
    reader.readAsText(file);
  }, [doParseAndPreview]);

  const handleFolderImport = useCallback((files: FileList) => {
    const supported = [".csv", ".txt", ".ini", ".xml"];
    const matching = Array.from(files).filter((f) => supported.some((ext) => f.name.toLowerCase().endsWith(ext)));
    if (matching.length === 0) { setImportMsg({ text: "No supported call log files found in folder.", type: "err" }); return; }
    let processed = 0; let totalImported = 0; let totalSkipped = 0; let totalErrors = 0;
    const allRows: StoredCall[] = [];
    const seenKeys = new Set<string>();

    const readNext = (idx: number) => {
      if (idx >= matching.length) {
        // dedupe across files too
        const deduped = allRows.filter((r) => { if (seenKeys.has(r.dedupeKey)) return false; seenKeys.add(r.dedupeKey); return true; });
        const { imported, skipped } = mergeImport(deduped);
        totalImported = imported; totalSkipped += skipped;
        const updated = loadCalls();
        setCalls(updated);
        const result: ImportResult = { imported: totalImported, skipped: totalSkipped, errors: totalErrors, errorDetails: [], total: updated.length, format: "Folder Import", timestamp: new Date().toISOString() };
        setLastImport(result); saveLastImport(result); setLastUpdated(new Date().toLocaleString());
        setImportMsg({ text: `Files processed: ${processed} — Calls imported: ${totalImported} — Duplicates skipped: ${totalSkipped}${totalErrors ? ` — Errors: ${totalErrors}` : ""}`, type: "ok" });
        setPreviewRows(null); setAllParsed(null); setImportText("");
        return;
      }
      const file = matching[idx];
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = (e.target?.result as string) ?? "";
        const { rows, errors } = parseText(text.trim());
        processed++;
        totalErrors += errors.length;
        rows.forEach((r) => allRows.push(toStoredCall(r, "standard-csv")));
        readNext(idx + 1);
      };
      reader.readAsText(file);
    };
    readNext(0);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileRead(file);
  }, [handleFileRead]);

  const handleConfirmImport = useCallback(() => {
    if (!allParsed) return;
    const { imported, skipped } = mergeImport(allParsed);
    const updated = loadCalls();
    setCalls(updated);
    const result: ImportResult = { imported, skipped, errors: parseErrors.length, errorDetails: parseErrors, total: updated.length, format: FORMAT_LABELS[detectedFormat as DetectedFormat] ?? detectedFormat, timestamp: new Date().toISOString() };
    setLastImport(result); saveLastImport(result); setLastUpdated(new Date().toLocaleString());
    setPreviewRows(null); setAllParsed(null); setImportText(""); setShowPaste(false);
    if (imported === 0) {
      setImportMsg({ text: `No new calls. All ${skipped} row${skipped !== 1 ? "s" : ""} already imported.`, type: "warn" });
    } else {
      setImportMsg({ text: `Imported: ${imported} new call${imported !== 1 ? "s" : ""} — Skipped: ${skipped} duplicates. Safe Import enabled.`, type: "ok" });
      setImportOpen(false);
    }
  }, [allParsed, parseErrors, detectedFormat]);

  const handleClearImport = useCallback(() => {
    setImportText(""); setPreviewRows(null); setAllParsed(null);
    setImportMsg(null); setStatusDebug(null); setDetectedFormat(""); setParseErrors([]); setShowPaste(false);
  }, []);

  // ── Manual add
  const handleManualAdd = useCallback(() => {
    const { callerName, phoneNumber, date, time, durationRaw, status, notes } = manualForm;
    let dur = 0;
    const mM = durationRaw.match(/(\d+)m/); const sM = durationRaw.match(/(\d+)s/);
    if (mM) dur += parseInt(mM[1]) * 60; if (sM) dur += parseInt(sM[1]);
    if (!mM && !sM && /^\d+$/.test(durationRaw)) dur = parseInt(durationRaw || "0");
    const newCall = toStoredCall({ callerName, phoneNumber, date, time, durationSeconds: dur, status, notes }, "manual");
    const existing = loadCalls();
    if (existing.some((c) => c.dedupeKey === newCall.dedupeKey)) { setManualMsg("Duplicate — call already exists."); return; }
    const updated = [...existing, newCall]; saveCalls(updated); setCalls(updated);
    setLastUpdated(new Date().toLocaleString());
    setManualForm({ callerName: "", phoneNumber: "", date: "", time: "", durationRaw: "", status: "Answered", notes: "" });
    setManualMsg("Call added."); setTimeout(() => setManualMsg(""), 2500);
  }, [manualForm]);

  // ── Clear all
  const handleClearAll = useCallback(() => {
    if (clearText !== "CLEAR") return;
    clearCalls(); setCalls([]); setLastImport(null);
    setClearText(""); setShowClearConfirm(false); setLastUpdated(new Date().toLocaleString());
  }, [clearText]);

  // ── Exports
  const handleExportCSV = useCallback(() => {
    const csv = generateMasterCSV(calls);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `pacific-calls-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [calls]);

  // ── Demo data
  const handleLoadDemo = useCallback(() => {
    const { imported, skipped } = mergeImport(SAMPLE_DATA);
    const updated = loadCalls(); setCalls(updated);
    const result: ImportResult = { imported, skipped, errors: 0, errorDetails: [], total: updated.length, format: "Demo Data", timestamp: new Date().toISOString() };
    setLastImport(result); saveLastImport(result); setLastUpdated(new Date().toLocaleString());
  }, []);

  const hasData = calls.length > 0;
  const msgColor = importMsg?.type === "ok" ? "border-green-800 bg-green-950/20 text-green-300" : importMsg?.type === "warn" ? "border-amber-800 bg-amber-950/20 text-amber-300" : "border-red-800 bg-red-950/20 text-red-300";

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono">
      {/* ── HEADER ── */}
      <header className="border-b border-zinc-800 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-widest uppercase text-white">PACIFIC SYSTEMS <span className="text-zinc-600">//</span> CALL LOGGER</h1>
          <p className="text-[10px] text-zinc-600 tracking-wide mt-0.5 uppercase">Hotline call data visualization</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasData && (
            <button onClick={() => setShowReport(true)}
              className="text-[11px] uppercase tracking-widest font-mono px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 transition-colors">
              Generate Report
            </button>
          )}
          <button onClick={() => { setImportOpen(!importOpen); if (!importOpen) setImportMsg(null); }}
            className="text-[11px] uppercase tracking-widest font-mono px-4 py-2 bg-blue-900 hover:bg-blue-800 text-blue-200 border border-blue-700 transition-colors">
            {importOpen ? "▲ Close Import" : "▼ Import Call Log"}
          </button>
        </div>
      </header>

      {/* ── IMPORT CARD ── */}
      {importOpen && (
        <div className="border-b border-zinc-800 bg-zinc-900/60 px-6 py-5">
          <div className="max-w-[1400px] mx-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[11px] font-mono text-zinc-300 font-semibold uppercase tracking-wider">Import Call Log</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">MicroSIP CSV / XML / INI · Callcentric CSV · Standard CSV &nbsp;·&nbsp; <span className="text-green-600">Safe Import ON</span> — duplicates skipped</p>
              </div>
              {detectedFormat && (
                <span className="text-[9px] border border-blue-700 bg-blue-950/30 text-blue-400 px-2 py-0.5 uppercase tracking-widest">
                  {FORMAT_LABELS[detectedFormat as DetectedFormat] ?? detectedFormat}
                </span>
              )}
            </div>

            {/* Compact drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              className={`border border-dashed py-5 flex items-center justify-center gap-6 transition-colors ${isDragOver ? "border-blue-500 bg-blue-950/20" : "border-zinc-700"}`}
            >
              <span className="text-[10px] text-zinc-500">Drop file here &nbsp;or:</span>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => fileInputRef.current?.click()} className="text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600">Choose File</button>
                <button onClick={() => folderInputRef.current?.click()} className="text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600">Import Folder</button>
                <button onClick={() => setShowPaste(!showPaste)} className="text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600">
                  {showPaste ? "▲ Paste Text" : "▼ Paste Text"}
                </button>
                <button onClick={handleClearImport} className="text-[10px] uppercase tracking-widest font-mono px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-500 border border-zinc-700">Clear</button>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,.txt,.ini,.xml" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileRead(f); e.target.value = ""; }} />
              <input ref={folderInputRef} type="file" className="hidden" multiple
                {...{ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>}
                onChange={(e) => { if (e.target.files?.length) handleFolderImport(e.target.files); e.target.value = ""; }} />
            </div>

            {/* Collapsible paste box */}
            {showPaste && (
              <textarea value={importText} onChange={(e) => { setImportText(e.target.value); setPreviewRows(null); setAllParsed(null); setImportMsg(null); }}
                rows={5} placeholder={"Name,Number,Date,Time,Duration,Status,Notes\nJohn Doe,13235551234,2025-04-01,09:00,5m 30s,Answered,Notes here\n\n--- or MicroSIP INI ---\n[Calls]\n0=13235551234;John Doe;1;1743460800;330;"}
                className="w-full mt-3 bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 placeholder-zinc-700 p-3 focus:outline-none focus:border-zinc-500 resize-y" />
            )}

            {/* Action buttons */}
            <div className="flex gap-2 mt-3 flex-wrap items-center">
              <Btn onClick={() => doParseAndPreview(importText)} variant="default">Import Log</Btn>
              {importMsg && (
                <span className={`text-[10px] font-mono px-3 py-1.5 border flex-1 min-w-0 truncate ${msgColor}`}>{importMsg.text}</span>
              )}
            </div>

            {/* Status breakdown debug */}
            {statusDebug && (
              <div className="mt-2 border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <p className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1.5">Mapped statuses</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(["Answered", "Call Ended", "Missed", "Canceled", "Voicemail", "Outgoing", "Other"] as const).map((s) => {
                    const n = statusDebug[s] ?? 0;
                    const accent = s === "Answered" ? "text-green-400" : s === "Call Ended" ? "text-blue-400" : s === "Missed" ? "text-red-400" : s === "Canceled" ? "text-orange-400" : s === "Voicemail" ? "text-amber-400" : s === "Outgoing" ? "text-violet-400" : n > 0 ? "text-red-300" : "text-zinc-700";
                    return (
                      <span key={s} className="text-[10px] font-mono">
                        <span className="text-zinc-600">{s}: </span>
                        <span className={`font-bold ${accent}`}>{n}</span>
                      </span>
                    );
                  })}
                  {(statusDebug["Other"] ?? 0) > 0 && (
                    <span className="text-[9px] text-red-500 self-center">↑ Other is high — check Info field values</span>
                  )}
                </div>
              </div>
            )}

            {/* Row errors */}
            {parseErrors.length > 0 && (
              <div className="mt-2">
                <button onClick={() => setShowErrors(!showErrors)} className="text-[10px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest">
                  {showErrors ? "▼" : "▶"} {parseErrors.length} row error{parseErrors.length !== 1 ? "s" : ""}
                </button>
                {showErrors && (
                  <div className="mt-1 border border-zinc-800 bg-zinc-950 p-2 text-[10px] text-red-400 font-mono space-y-0.5 max-h-24 overflow-y-auto">
                    {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
            )}

            {/* Preview */}
            {previewRows && previewRows.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Preview — first {previewRows.length} of {allParsed?.length ?? 0} rows</p>
                <div className="overflow-x-auto border border-zinc-700">
                  <table className="w-full text-xs font-mono min-w-[580px]">
                    <thead>
                      <tr className="border-b border-zinc-700 bg-zinc-900">
                        {["Caller", "Masked Number", "Date", "Time", "Duration", "Status"].map((h) => (
                          <th key={h} className="text-left text-[9px] uppercase tracking-widest text-zinc-500 px-3 py-1.5 font-normal">{h}</th>
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
                <div className="mt-2">
                  <Btn onClick={handleConfirmImport} variant="green">Confirm Import ({allParsed?.length} calls)</Btn>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LAST IMPORT STATUS BAR ── */}
      {lastImport && !importOpen && (
        <div className="border-b border-zinc-800/60 bg-zinc-900/30 px-6 py-2">
          <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest max-w-[1400px] mx-auto">
            Last Import: <span className="text-zinc-500">{formatTimestamp(lastImport.timestamp)}</span>
            &nbsp;·&nbsp; Format: <span className="text-zinc-500">{lastImport.format}</span>
            &nbsp;·&nbsp; Imported: <span className="text-green-600">{lastImport.imported}</span>
            &nbsp;·&nbsp; Skipped: <span className="text-zinc-500">{lastImport.skipped}</span>
          </p>
        </div>
      )}

      <main className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto space-y-8">

        {/* ── EMPTY STATE ── */}
        {!hasData && (
          <div className="border border-dashed border-zinc-800 py-20 flex flex-col items-center justify-center text-center gap-4">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600">No call logs imported yet</p>
            <p className="text-sm text-zinc-500 max-w-sm">Import a MicroSIP or Callcentric export to begin. Drag a file, paste text, or click <span className="text-blue-400">Import Call Log</span> above.</p>
            <button onClick={() => setImportOpen(true)} className="mt-2 text-[11px] uppercase tracking-widest font-mono px-5 py-2 bg-blue-900 hover:bg-blue-800 text-blue-200 border border-blue-700 transition-colors">
              Import Call Log
            </button>
          </div>
        )}

        {/* ── METRICS ── */}
        {hasData && (
          <Sec title="Overview" action={
            <p className="text-[10px] text-zinc-600 font-mono">Last updated: <span className="text-zinc-500">{lastUpdated}</span></p>
          }>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-zinc-800">
              <MetricCard label="Total Calls" value={String(metrics.total)} />
              <MetricCard label="Answered / Ended" value={String(metrics.answered)} accent="text-green-400" />
              <MetricCard label="Missed / Canceled" value={String(metrics.missed)} accent="text-red-400" />
              <MetricCard label="Voicemails" value={String(metrics.voicemail)} accent="text-amber-400" />
              <MetricCard label="Outgoing" value={String(metrics.outgoing)} accent="text-violet-400" />
              <MetricCard label="Repeat Callers" value={String(metrics.repeatCallers)} accent="text-blue-400" />
              <MetricCard label="Avg Duration" value={formatDuration(metrics.avgSec)} />
              <MetricCard label="Peak Hour" value={metrics.peakHour} accent="text-amber-400" />
            </div>
          </Sec>
        )}

        {/* ── CHARTS ── */}
        {hasData && (
          <>
            <Sec title="Call Volume">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Calls by Hour</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={callsByHour} barCategoryGap="20%">
                      <XAxis dataKey="hour" tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} width={20} />
                      <Tooltip content={<CT />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar dataKey="count" fill="#3b82f6" name="Calls" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Calls by Day</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={callsByDay} barCategoryGap="20%">
                      <XAxis dataKey="day" tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} width={20} />
                      <Tooltip content={<CT />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar dataKey="count" fill="#22c55e" name="Calls" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Sec>

            <Sec title="Status & Callers">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">By Status</p>
                  {callsByStatus.length === 0 ? <EmptyChart label="No data" /> : (
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={callsByStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={65} innerRadius={28} stroke="none" paddingAngle={2}>
                          {callsByStatus.map((e, i) => <Cell key={i} fill={e.fill} />)}
                        </Pie>
                        <Tooltip content={<CT />} />
                        <Legend iconSize={7} iconType="circle" formatter={(v) => <span style={{ fontSize: 9, fontFamily: "monospace", color: "#a1a1aa" }}>{v}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Repeat Callers</p>
                  {repeatCallerChart.length === 0 ? <EmptyChart label="No repeat callers" /> : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={repeatCallerChart} layout="vertical" barCategoryGap="20%">
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fontFamily: "monospace", fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={55} />
                        <Tooltip content={<CT />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="count" fill="#8b5cf6" name="Calls" radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Longest Calls</p>
                  {longestChart.length === 0 ? <EmptyChart label="No duration data" /> : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={longestChart} layout="vertical" barCategoryGap="20%">
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fontFamily: "monospace", fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={55} />
                        <Tooltip content={(p) => {
                          if (!p.active || !p.payload?.length) return null;
                          const row = longestChart.find((r) => r.name === p.label);
                          return <div className="border border-zinc-600 bg-zinc-900 p-2 text-xs font-mono text-zinc-300"><p className="text-zinc-400">{p.label}</p><p>{row?.label}</p></div>;
                        }} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="seconds" fill="#f59e0b" name="Seconds" radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Follow-up Targets</p>
                  {followUpTargets.length === 0 ? <EmptyChart label="No targets" /> : (
                    <div className="space-y-1.5 overflow-y-auto max-h-[180px]">
                      {followUpTargets.slice(0, 7).map((t, i) => (
                        <div key={i} className="border border-zinc-800 px-2 py-1.5">
                          <div className="flex justify-between">
                            <span className="text-xs text-zinc-200 truncate max-w-[100px]">{t.name}</span>
                            <span className="text-xs font-bold text-amber-400 ml-2">{t.count}</span>
                          </div>
                          <div className="flex gap-1 flex-wrap mt-0.5">
                            {Array.from(t.reasons).map((r, j) => <span key={j} className="text-[8px] border border-zinc-800 text-zinc-600 px-1">{r}</span>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Sec>
          </>
        )}

        {/* ── FOLLOW-UP TABLE ── */}
        {hasData && followUpTargets.length > 0 && (
          <Sec title="Follow-up Queue">
            <div className="overflow-x-auto border border-zinc-700">
              <table className="w-full text-xs font-mono min-w-[580px]">
                <thead>
                  <tr className="border-b border-zinc-700 bg-zinc-900">
                    {["Caller", "Number", "Reason(s)", "Last Contact", "Count"].map((h) => (
                      <th key={h} className="text-left text-[9px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {followUpTargets.map((t, i) => (
                    <tr key={i} className={`border-b border-zinc-800 ${i % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/30"}`}>
                      <td className="px-3 py-2 text-zinc-200">{t.name}</td>
                      <td className="px-3 py-2 text-zinc-500">{t.number}</td>
                      <td className="px-3 py-2 text-amber-400">{Array.from(t.reasons).join(", ")}</td>
                      <td className="px-3 py-2 text-zinc-600 text-[10px]">{t.lastTime}</td>
                      <td className="px-3 py-2 font-bold text-white">{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sec>
        )}

        {/* ── CALL TABLE ── */}
        {hasData && (
          <Sec title="Call Log" action={
            <p className="text-[10px] text-zinc-600 font-mono">{filtered.length} of {calls.length} shown</p>
          }>
            <div className="flex flex-col sm:flex-row gap-2 mb-3 flex-wrap">
              <div className="flex gap-1 flex-wrap">
                {FILTER_STATUSES.map((s) => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`text-[9px] px-2 py-1 border uppercase tracking-widest font-mono transition-colors ${statusFilter === s ? "border-zinc-400 text-white bg-zinc-700" : "border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400"}`}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 ml-auto">
                <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="text-xs font-mono bg-zinc-900 border border-zinc-700 px-3 py-1 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-44" />
                <button onClick={() => setShowMasked(!showMasked)} className="text-[9px] px-2 py-1 border border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400 uppercase tracking-widest font-mono">
                  {showMasked ? "Show #" : "Mask #"}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto border border-zinc-700">
              <table className="w-full text-xs font-mono min-w-[800px]">
                <thead>
                  <tr className="border-b border-zinc-700 bg-zinc-900">
                    {["Caller", "Number", "Date", "Time", "Duration", "Status", "Source", "Notes"].map((h) => (
                      <th key={h} className="text-left text-[9px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-zinc-700">No records match.</td></tr>}
                  {filtered.map((r, i) => (
                    <tr key={i} className={`border-b border-zinc-800/70 ${i % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/30"} hover:bg-zinc-800/40`}>
                      <td className="px-3 py-2 text-zinc-200">{r.callerName}</td>
                      <td className="px-3 py-2 text-zinc-500 tracking-wide">{showMasked ? r.maskedNumber : r.phoneNumber}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.date}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.time}</td>
                      <td className="px-3 py-2 text-zinc-300">{r.duration}</td>
                      <td className={`px-3 py-2 ${STATUS_TEXT[r.status] ?? "text-zinc-400"}`}>{r.status}</td>
                      <td className="px-3 py-2 text-zinc-700 text-[9px]">{SOURCE_LABELS[r.source] ?? r.source}</td>
                      <td className="px-3 py-2 text-zinc-600 max-w-[180px] truncate">{r.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sec>
        )}

        {/* ── MANUAL ADD ── */}
        {hasData && (
          <Sec title="Manual Entry">
            <button onClick={() => setShowManualAdd(!showManualAdd)} className="text-[10px] uppercase tracking-widest font-mono text-zinc-600 hover:text-zinc-400 flex items-center gap-1 mb-3">
              {showManualAdd ? "▼" : "▶"} {showManualAdd ? "Hide" : "Show"} Manual Add Form
            </button>
            {showManualAdd && (
              <div className="border border-zinc-700 bg-zinc-900 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { label: "Caller Name", key: "callerName", placeholder: "Maria Delgado" },
                    { label: "Phone Number", key: "phoneNumber", placeholder: "13235551212" },
                    { label: "Date", key: "date", placeholder: "2025-04-01" },
                    { label: "Time", key: "time", placeholder: "09:30" },
                    { label: "Duration", key: "durationRaw", placeholder: "5m 30s or 330" },
                  ].map(({ label, key, placeholder }) => (
                    <div key={key}>
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1">{label}</p>
                      <input type="text" value={manualForm[key as keyof typeof manualForm] as string}
                        onChange={(e) => setManualForm({ ...manualForm, [key]: e.target.value })}
                        placeholder={placeholder}
                        className="w-full bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 placeholder-zinc-700 px-3 py-2 focus:outline-none focus:border-zinc-500" />
                    </div>
                  ))}
                  <div>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1">Status</p>
                    <select value={manualForm.status} onChange={(e) => setManualForm({ ...manualForm, status: e.target.value as CallStatus })}
                      className="w-full bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 px-3 py-2 focus:outline-none focus:border-zinc-500">
                      {["Answered", "Call Ended", "Missed", "Canceled", "Voicemail", "Outgoing", "Other"].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="lg:col-span-3">
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1">Notes</p>
                    <input type="text" value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                      placeholder="Optional notes" className="w-full bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 placeholder-zinc-700 px-3 py-2 focus:outline-none focus:border-zinc-500" />
                  </div>
                  <div className="lg:col-span-3 flex items-center gap-3">
                    <Btn onClick={handleManualAdd} variant="green" small>Add Call</Btn>
                    {manualMsg && <span className={`text-xs font-mono ${manualMsg.includes("Duplicate") ? "text-red-400" : "text-green-400"}`}>{manualMsg}</span>}
                  </div>
                </div>
              </div>
            )}
          </Sec>
        )}

        {/* ── EXPORT ── */}
        {hasData && (
          <Sec title="Export & Database">
            <div className="flex gap-2 flex-wrap items-center">
              <Btn onClick={handleExportCSV} variant="default" small>Export Master CSV</Btn>
              <Btn onClick={() => setShowReport(true)} variant="amber" small>Generate One-Page Report</Btn>
              <Btn onClick={() => setShowClearConfirm(!showClearConfirm)} variant="red" small>Clear All Calls</Btn>
              <span className="text-[9px] text-zinc-700 font-mono ml-2">{calls.length} calls in local storage</span>
            </div>
            {showClearConfirm && (
              <div className="mt-3 border border-red-900 bg-red-950/20 p-4 max-w-md">
                <p className="text-xs text-red-300 mb-2">Permanently delete all {calls.length} stored calls. Type CLEAR to confirm.</p>
                <input type="text" value={clearText} onChange={(e) => setClearText(e.target.value)} placeholder="Type CLEAR"
                  className="w-full bg-zinc-950 border border-red-800 text-xs font-mono text-zinc-300 px-3 py-2 focus:outline-none mb-2" />
                <div className="flex gap-2">
                  <Btn onClick={handleClearAll} variant="red" small>Confirm Delete</Btn>
                  <Btn onClick={() => { setShowClearConfirm(false); setClearText(""); }} variant="ghost" small>Cancel</Btn>
                </div>
              </div>
            )}
          </Sec>
        )}

        {/* ── DEV TOOLS ── */}
        <div className="border-t border-zinc-900 pt-4">
          <button onClick={() => setShowDevTools(!showDevTools)} className="text-[9px] uppercase tracking-widest font-mono text-zinc-800 hover:text-zinc-600 flex items-center gap-1">
            {showDevTools ? "▼" : "▶"} Developer / Demo Tools
          </button>
          {showDevTools && (
            <div className="mt-3 border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
              <p className="text-[10px] text-zinc-600">Load sample data for testing. Will not appear by default on first load.</p>
              <div className="flex gap-2">
                <Btn onClick={handleLoadDemo} variant="ghost" small>Load Demo Data</Btn>
              </div>
            </div>
          )}
        </div>

      </main>

      <footer className="border-t border-zinc-800/60 px-6 py-3">
        <p className="text-[9px] text-zinc-800 uppercase tracking-widest">Pacific Systems // Call Logger — All data stored locally in your browser. No server. No login.</p>
      </footer>

      {/* ── REPORT MODAL ── */}
      {showReport && (
        <Suspense fallback={null}>
          <ReportModal calls={calls} lastImport={lastImport} onClose={() => setShowReport(false)} />
        </Suspense>
      )}
    </div>
  );
}
