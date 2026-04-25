import { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { type StoredCall, type CallStatus, type ImportResult } from "@/lib/types";
import {
  loadCalls, saveCalls, clearCalls, loadLastImport, saveLastImport,
  mergeImport, migrateAll, loadLastMigrationTime,
  loadSchemaVersion, runSchemaRepair,
  DATA_SCHEMA_VERSION,
  type MigrateResult, type SchemaRepairResult,
} from "@/lib/storage";
import { getCallDate, getDateKey, getHourKey } from "@/lib/callDate";
import { parseText, toStoredCall, FORMAT_LABELS, type DetectedFormat, type ImportDebug } from "@/lib/parsers";
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

function hourLabel(h: number): string {
  if (h === 0) return "12AM";
  if (h < 12) return `${h}AM`;
  if (h === 12) return "12PM";
  return `${h - 12}PM`;
}

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
      <p className="text-[10px] text-zinc-700 uppercase tracking-widest text-center px-2">{label}</p>
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

  // Guard: run schema repair exactly once per page load
  const repairDone = useRef(false);

  // ── Production repair state
  const [schemaVersion, setSchemaVersion] = useState<number>(() => loadSchemaVersion());
  const [schemaRepairResult, setSchemaRepairResult] = useState<SchemaRepairResult | null>(null);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
  const [migrationRan, setMigrationRan] = useState(false);

  // Startup: always repair if schema version is behind
  useEffect(() => {
    if (repairDone.current) return;
    repairDone.current = true;

    const storedVersion = loadSchemaVersion();
    const needsRepair = storedVersion < DATA_SCHEMA_VERSION;

    if (needsRepair) {
      // Full schema repair: re-derives timestamps + normalizes statuses
      const result = runSchemaRepair();
      setSchemaRepairResult(result);
      setSchemaVersion(DATA_SCHEMA_VERSION);
      setCalls(loadCalls());
      setMigrationRan(true);
      console.log("[schema repair] ran", result);
    } else {
      setMigrationRan(false);
    }

    // Debug log for one sample call regardless
    const sample = loadCalls()[0];
    if (sample) {
      console.log("sample call for chart parsing", sample, getCallDate(sample), getDateKey(sample), getHourKey(sample));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [importDebug, setImportDebug] = useState<ImportDebug | null>(null);
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
  const [migrateResult, setMigrateResult] = useState<MigrateResult | null>(null);

  // ── Data quality panel
  const [showDataQuality, setShowDataQuality] = useState(false);

  // ── Auto-repair if charts are empty despite calls existing
  const autoRepairDone = useRef(false);
  useEffect(() => {
    if (autoRepairDone.current || calls.length === 0) return;
    const hasValidTs = calls.some((c) => getCallDate(c) !== null);
    if (!hasValidTs && !autoRepairDone.current) {
      autoRepairDone.current = true;
      const result = runSchemaRepair();
      setSchemaRepairResult(result);
      setCalls(loadCalls());
      console.log("[auto-repair] triggered due to empty timestamps", result);
    }
  }, [calls]);

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
    // Peak hour — use canonical getHourKey which falls back through all raw fields
    const hourCounts: Record<number, number> = {};
    calls.forEach((c) => {
      const h = getHourKey(c);
      if (h !== null) hourCounts[h] = (hourCounts[h] ?? 0) + 1;
    });
    const peakEntry = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0];
    const peakHour = peakEntry ? hourLabel(Number(peakEntry[0])) : "—";
    return { total, answered, missed, voicemail, outgoing, repeatCallers, avgSec, longest, peakHour, nameCounts };
  }, [calls]);

  // Timestamp quality stats — used for debug display and Data Quality panel
  const tsQuality = useMemo(() => {
    let valid = 0;
    let unknown = 0;
    calls.forEach((c) => {
      if (getCallDate(c) !== null) valid++;
      else unknown++;
    });
    return { valid, unknown, total: calls.length };
  }, [calls]);

  // Calls by hour — use getHourKey which reads rawTime/startedAtISO/unix fallback
  const callsByHour = useMemo(() => {
    const map: Record<number, number> = {};
    for (let h = 0; h < 24; h++) map[h] = 0;
    calls.forEach((c) => {
      const h = getHourKey(c);
      if (h !== null) map[h] = (map[h] ?? 0) + 1;
    });

    const allHours = Array.from({ length: 24 }, (_, h) => ({ h, count: map[h] }));
    const nonZeroIndices = allHours.map((e, i) => (e.count > 0 ? i : -1)).filter((i) => i >= 0);

    let startIdx = 0;
    let endIdx = 23;
    if (nonZeroIndices.length > 0) {
      startIdx = Math.max(0, nonZeroIndices[0] - 1);
      endIdx = Math.min(23, nonZeroIndices[nonZeroIndices.length - 1] + 1);
    }

    return allHours.slice(startIdx, endIdx + 1).map(({ h, count }) => ({
      hour: hourLabel(h),
      count,
      dim: count === 0,
    }));
  }, [calls]);

  const hasHourData = useMemo(() => calls.some((c) => getHourKey(c) !== null), [calls]);

  // Calls by day — use getDateKey which handles all raw field fallbacks
  const callsByDay = useMemo(() => {
    const map: Record<string, number> = {};
    calls.forEach((c) => {
      const key = getDateKey(c);
      if (key && key !== "unknown") map[key] = (map[key] ?? 0) + 1;
    });
    const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-14);
    return entries.map(([date, count]) => {
      try {
        const d = new Date(date + "T12:00:00");
        return { day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count, date };
      } catch {
        return { day: date, count, date };
      }
    });
  }, [calls]);

  const hasDayData = useMemo(() => calls.some((c) => getDateKey(c) !== "unknown"), [calls]);

  const callsByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    calls.forEach((c) => { map[c.status] = (map[c.status] ?? 0) + 1; });
    return Object.entries(map).map(([status, count]) => ({ status, count, fill: STATUS_COLORS[status] ?? "#71717a" }));
  }, [calls]);

  const otherDebug = useMemo(() => {
    const others = calls.filter((c) => c.status === "Other");
    const noteCounts: Record<string, number> = {};
    others.forEach((c) => {
      const key = c.notes.trim() || "(no info)";
      noteCounts[key] = (noteCounts[key] ?? 0) + 1;
    });
    const top = Object.entries(noteCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
    return { count: others.length, top };
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

  // Follow-up volume by day (Missed + Canceled + Voicemail)
  const followUpByDay = useMemo(() => {
    const map: Record<string, number> = {};
    calls.filter((c) => c.status === "Missed" || c.status === "Canceled" || c.status === "Voicemail")
      .forEach((c) => {
        const key = getDateKey(c);
        if (key && key !== "unknown") map[key] = (map[key] ?? 0) + 1;
      });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, count]) => {
      try {
        const d = new Date(date + "T12:00:00");
        return { day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count };
      } catch {
        return { day: date, count };
      }
    });
  }, [calls]);

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

  // Data quality stats
  const dataQuality = useMemo(() => {
    const total = calls.length;
    // Use canonical getCallDate so we count resolved timestamps, not just stored ISO strings
    const withTimestamp = calls.filter((c) => getCallDate(c) !== null).length;
    const missingTimestamp = total - withTimestamp;
    const otherCount = calls.filter((c) => c.status === "Other").length;
    const lastMigration = loadLastMigrationTime();
    const seenKeys = new Set<string>();
    let duplicateKeys = 0;
    calls.forEach((c) => { if (seenKeys.has(c.dedupeKey)) { duplicateKeys++; } else { seenKeys.add(c.dedupeKey); } });
    return { total, withTimestamp, missingTimestamp, otherCount, duplicateKeys, lastMigration };
  }, [calls]);

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
    const { rows, errors, format, debug } = parseText(trimmed);
    setDetectedFormat(format);
    setParseErrors(errors);
    setShowErrors(false);
    setImportDebug(debug ?? null);
    if (rows.length === 0) {
      setImportMsg({ text: errors[0] ?? "Import failed: no rows detected.", type: "err" });
      setPreviewRows(null); setAllParsed(null); setStatusDebug(null); return;
    }
    const stored = rows.map((r) => toStoredCall(r, format as StoredCall["source"]));
    setAllParsed(stored);
    setPreviewRows(stored.slice(0, 5));
    const counts: Record<string, number> = {};
    stored.forEach((c) => { counts[c.status] = (counts[c.status] ?? 0) + 1; });
    setStatusDebug(counts);
    const tsErrors = debug?.invalidTimestampCount ?? rows.filter((r) => r.parseError || !r.dateKey).length;
    const skipNote = (debug?.skippedCount ?? 0) > 0 ? ` · ${debug!.skippedCount} row${debug!.skippedCount !== 1 ? "s" : ""} skipped (invalid timestamp)` : "";
    const tsNote = tsErrors > 0 ? ` · ${tsErrors} timestamp warning${tsErrors !== 1 ? "s" : ""}` : "";
    setImportMsg({ text: `Auto-detected: ${FORMAT_LABELS[format]}. ${rows.length} row${rows.length !== 1 ? "s" : ""} ready — review preview below.${tsNote}${skipNote}`, type: (tsErrors > 0 || (debug?.skippedCount ?? 0) > 0) ? "warn" : "ok" });
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
    setImportMsg(null); setStatusDebug(null); setImportDebug(null); setDetectedFormat(""); setParseErrors([]); setShowPaste(false);
  }, []);

  // ── Manual add
  const handleManualAdd = useCallback(() => {
    const { callerName, phoneNumber, date, time, durationRaw, status, notes } = manualForm;
    let dur = 0;
    const mM = durationRaw.match(/(\d+)m/); const sM = durationRaw.match(/(\d+)s/);
    if (mM) dur += parseInt(mM[1]) * 60; if (sM) dur += parseInt(sM[1]);
    if (!mM && !sM && /^\d+$/.test(durationRaw)) dur = parseInt(durationRaw || "0");
    const hour = time ? parseInt(time.split(":")[0], 10) : 0;
    const newCall = toStoredCall({ callerName, phoneNumber, date, time, durationSeconds: dur, status, notes, startedAtISO: "", dateKey: date, hourKey: isNaN(hour) ? 0 : hour }, "manual");
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

            {/* Import debug summary */}
            {importDebug && importDebug.importedCount > 0 && (
              <div className="mt-2 border border-zinc-800 bg-zinc-950/60 px-3 py-2 space-y-1">
                <p className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1.5">Import Summary</p>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span className="text-[10px] font-mono">
                    <span className="text-zinc-600">Parsed: </span>
                    <span className="text-green-500 font-bold">{importDebug.importedCount}</span>
                  </span>
                  {importDebug.skippedCount > 0 && (
                    <span className="text-[10px] font-mono">
                      <span className="text-zinc-600">Skipped: </span>
                      <span className="text-amber-500 font-bold">{importDebug.skippedCount}</span>
                      <span className="text-zinc-700 ml-1">(invalid timestamp)</span>
                    </span>
                  )}
                  {importDebug.invalidTimestampCount > 0 && (
                    <span className="text-[10px] font-mono">
                      <span className="text-zinc-600">No timestamp: </span>
                      <span className="text-red-400 font-bold">{importDebug.invalidTimestampCount}</span>
                    </span>
                  )}
                  {importDebug.earliestCall && (
                    <span className="text-[10px] font-mono">
                      <span className="text-zinc-600">Earliest: </span>
                      <span className="text-zinc-400">{new Date(importDebug.earliestCall).toLocaleString()}</span>
                    </span>
                  )}
                  {importDebug.latestCall && (
                    <span className="text-[10px] font-mono">
                      <span className="text-zinc-600">Latest: </span>
                      <span className="text-zinc-400">{new Date(importDebug.latestCall).toLocaleString()}</span>
                    </span>
                  )}
                </div>
                {importDebug.busiestHours.length > 0 && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] text-zinc-600 uppercase tracking-widest">Top hours:</span>
                    {importDebug.busiestHours.map((h, i) => (
                      <span key={i} className="text-[10px] font-mono">
                        <span className="text-amber-500">{h.label}</span>
                        <span className="text-zinc-600 ml-1">({h.count})</span>
                      </span>
                    ))}
                  </div>
                )}
                {importDebug.detectedColumns.length > 0 && (
                  <p className="text-[9px] font-mono text-zinc-700 mt-1">
                    Columns detected: {importDebug.detectedColumns.join(", ")}
                  </p>
                )}
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
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Calls by Hour */}
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Calls by Hour</p>
                  {!hasHourData ? (
                    <EmptyChart label="No valid timestamp data found. Check import format." />
                  ) : callsByHour.length === 0 ? (
                    <EmptyChart label="No hourly data" />
                  ) : (
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={callsByHour} barCategoryGap="15%">
                        <XAxis dataKey="hour" tick={{ fontSize: 8, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} interval={0} angle={-45} textAnchor="end" height={28} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} width={20} />
                        <Tooltip content={<CT />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="count" name="Calls" radius={[2, 2, 0, 0]}>
                          {callsByHour.map((entry, i) => (
                            <Cell key={i} fill={entry.dim ? "#1e293b" : "#3b82f6"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Calls by Day */}
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Calls by Day</p>
                  {!hasDayData ? (
                    <EmptyChart label="No valid timestamp data found. Check import format." />
                  ) : callsByDay.length === 0 ? (
                    <EmptyChart label="No date data" />
                  ) : (
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={callsByDay} barCategoryGap="20%">
                        <XAxis dataKey="day" tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} width={20} />
                        <Tooltip content={<CT />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="count" fill="#22c55e" name="Calls" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Follow-Up Volume by Day */}
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Follow-Up Volume</p>
                  <p className="text-[9px] text-zinc-700 mb-3">Missed + Canceled + Voicemail by day</p>
                  {followUpByDay.length === 0 ? (
                    <EmptyChart label="No follow-up calls" />
                  ) : (
                    <ResponsiveContainer width="100%" height={148}>
                      <BarChart data={followUpByDay} barCategoryGap="20%">
                        <XAxis dataKey="day" tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fontFamily: "monospace", fill: "#52525b" }} axisLine={false} tickLine={false} width={20} />
                        <Tooltip content={<CT />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="count" fill="#f97316" name="Follow-Ups" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </Sec>

            {/* Production debug strip */}
            {hasData && (
              <div className="border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
                    Timestamp valid: <span className={tsQuality.valid === tsQuality.total ? "text-green-600" : "text-amber-500"}>{tsQuality.valid}</span>
                    {" / Total: "}<span className="text-zinc-500">{tsQuality.total}</span>
                    {tsQuality.unknown > 0 && <span className="ml-2 text-amber-500">Invalid: {tsQuality.unknown}</span>}
                    {tsQuality.valid === tsQuality.total && tsQuality.total > 0 && <span className="ml-2 text-green-700">✓ all resolvable</span>}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-700">
                    Schema: <span className="text-zinc-500">{schemaVersion}</span> / <span className="text-zinc-600">{DATA_SCHEMA_VERSION}</span>
                    {schemaVersion < DATA_SCHEMA_VERSION && <span className="text-amber-600 ml-1">↑ outdated</span>}
                    {schemaVersion >= DATA_SCHEMA_VERSION && <span className="text-green-800 ml-1">✓</span>}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-700">
                    Migration: <span className={migrationRan ? "text-blue-600" : "text-zinc-700"}>{migrationRan ? "ran" : "skipped"}</span>
                  </span>
                  {(() => {
                    const first = calls[0];
                    if (!first) return null;
                    const rawVal = (first as Record<string, unknown>).rawTime ?? first.time ?? "—";
                    const parsedHour = getHourKey(first);
                    return (
                      <span className="text-[9px] font-mono text-zinc-700">
                        First call raw time: <span className="text-zinc-500">{String(rawVal).slice(0, 20)}</span>
                        {" · "}parsed hour: <span className={parsedHour !== null ? "text-green-700" : "text-red-700"}>{parsedHour !== null ? parsedHour : "invalid"}</span>
                      </span>
                    );
                  })()}
                </div>
                {/* Manual repair button + result */}
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => {
                      const result = runSchemaRepair();
                      setSchemaRepairResult(result);
                      setSchemaVersion(DATA_SCHEMA_VERSION);
                      setCalls(loadCalls());
                      setRepairMsg(`Repaired ${result.timestampRepaired} calls. Valid timestamps: ${calls.filter((c) => getCallDate(c) !== null).length + result.timestampRepaired} / ${result.total}.`);
                      setTimeout(() => setRepairMsg(null), 6000);
                    }}
                    className="text-[9px] uppercase tracking-widest font-mono px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 transition-colors">
                    Repair Production Timestamps
                  </button>
                  {repairMsg && (
                    <span className="text-[9px] font-mono text-green-500">{repairMsg}</span>
                  )}
                  {schemaRepairResult && !repairMsg && (
                    <span className="text-[9px] font-mono text-zinc-700">
                      Last repair: ts={schemaRepairResult.timestampRepaired} purged={schemaRepairResult.purgedCount} status={schemaRepairResult.statusFixed} total={schemaRepairResult.total}
                    </span>
                  )}
                </div>
              </div>
            )}

            <Sec title="Status & Callers">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* By Status pie */}
                <div className="border border-zinc-700 bg-zinc-900 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">By Status</p>
                  {callsByStatus.length === 0 ? <EmptyChart label="No data" /> : (
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie data={callsByStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={58} innerRadius={24} stroke="none" paddingAngle={2}>
                          {callsByStatus.map((e, i) => <Cell key={i} fill={e.fill} />)}
                        </Pie>
                        <Tooltip content={<CT />} />
                        <Legend iconSize={7} iconType="circle" formatter={(v) => <span style={{ fontSize: 9, fontFamily: "monospace", color: "#a1a1aa" }}>{v}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                  {/* Other debug */}
                  <div className="border-t border-zinc-800 pt-2 mt-1">
                    <p className="text-[9px] font-mono text-zinc-600">
                      Other: <span className={otherDebug.count > 0 ? "text-red-400 font-bold" : "text-zinc-600"}>{otherDebug.count}</span>
                      {otherDebug.count === 0 && <span className="text-green-700 ml-1">✓ clean</span>}
                    </p>
                    {otherDebug.count > 0 && otherDebug.top.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {otherDebug.top.map(([note, n], i) => (
                          <p key={i} className="text-[9px] font-mono text-zinc-700 truncate">
                            <span className="text-red-700">{n}×</span> {note}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Repeat Callers */}
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

                {/* Longest Calls */}
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

                {/* Follow-up Targets */}
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
                <p className="text-xs text-red-300 mb-2">Permanently delete all {calls.length} stored calls. Type <span className="font-bold text-red-200">CLEAR</span> to confirm.</p>
                <input type="text" value={clearText} onChange={(e) => setClearText(e.target.value)} placeholder="Type CLEAR"
                  className="w-full bg-zinc-950 border border-red-800 text-xs font-mono text-zinc-300 px-3 py-2 focus:outline-none mb-2" />
                <div className="flex gap-2">
                  <Btn onClick={handleClearAll} variant="red" small disabled={clearText !== "CLEAR"}>Confirm Delete</Btn>
                  <Btn onClick={() => { setShowClearConfirm(false); setClearText(""); }} variant="ghost" small>Cancel</Btn>
                </div>
              </div>
            )}
          </Sec>
        )}

        {/* ── DATA QUALITY PANEL ── */}
        {hasData && (
          <div className="border border-zinc-800">
            <button onClick={() => setShowDataQuality(!showDataQuality)}
              className="w-full text-left px-4 py-2.5 text-[9px] uppercase tracking-widest font-mono text-zinc-600 hover:text-zinc-400 flex items-center justify-between">
              <span>{showDataQuality ? "▼" : "▶"} Data Quality</span>
              <span className={`text-[8px] px-1.5 py-0.5 border ${dataQuality.otherCount > 0 || dataQuality.missingTimestamp > 0 ? "border-amber-800 text-amber-600" : "border-green-900 text-green-700"}`}>
                {dataQuality.otherCount > 0 || dataQuality.missingTimestamp > 0 ? "Review Needed" : "✓ Good"}
              </span>
            </button>
            {showDataQuality && (
              <div className="border-t border-zinc-800 px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Total Calls", value: dataQuality.total, color: "text-white" },
                  { label: "Valid Timestamps", value: dataQuality.withTimestamp, color: dataQuality.withTimestamp === dataQuality.total ? "text-green-400" : "text-amber-400" },
                  { label: "Missing Timestamps", value: dataQuality.missingTimestamp, color: dataQuality.missingTimestamp === 0 ? "text-zinc-600" : "text-amber-400" },
                  { label: "Other Status", value: dataQuality.otherCount, color: dataQuality.otherCount === 0 ? "text-zinc-600" : "text-red-400" },
                  { label: "Duplicate Keys", value: dataQuality.duplicateKeys, color: dataQuality.duplicateKeys === 0 ? "text-zinc-600" : "text-amber-400" },
                  { label: "Date Coverage", value: callsByDay.length > 0 ? `${callsByDay.length}d` : "—", color: "text-zinc-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-zinc-900 border border-zinc-800 p-3">
                    <p className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">{label}</p>
                    <p className={`text-lg font-mono font-bold ${color}`}>{value}</p>
                  </div>
                ))}
                {dataQuality.lastMigration && (
                  <div className="col-span-full mt-1">
                    <p className="text-[9px] text-zinc-700 font-mono">Last rebuild: {new Date(dataQuality.lastMigration).toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── DEV TOOLS ── */}
        <div className="border-t border-zinc-900 pt-4">
          <button onClick={() => setShowDevTools(!showDevTools)} className="text-[9px] uppercase tracking-widest font-mono text-zinc-800 hover:text-zinc-600 flex items-center gap-1">
            {showDevTools ? "▼" : "▶"} Developer / Demo Tools
          </button>
          {showDevTools && (
            <div className="mt-3 border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
              {/* Rebuild / Recalculate */}
              <div>
                <p className="text-[10px] text-zinc-600 mb-1">Re-normalize statuses · Recalculate timestamps · Rebuild dedupe keys · Refresh charts.</p>
                <div className="flex items-start gap-3 flex-wrap">
                  <Btn onClick={() => {
                    const result = migrateAll();
                    setCalls(loadCalls());
                    setMigrateResult(result);
                  }} variant="ghost" small>Rebuild / Recalculate Data</Btn>
                  {migrateResult && (
                    <div className="text-[10px] font-mono text-zinc-500 leading-relaxed">
                      <span>Rebuilt <span className="text-green-400 font-bold">{migrateResult.fixed + migrateResult.timestampFixed}</span> call{migrateResult.fixed + migrateResult.timestampFixed !== 1 ? "s" : ""}.</span>
                      <span className="ml-3">Status fixes: <span className="text-green-400">{migrateResult.fixed}</span></span>
                      <span className="ml-3">Timestamp fixes: <span className="text-blue-400">{migrateResult.timestampFixed}</span></span>
                      <span className="ml-3">Timestamp errors: <span className={migrateResult.timestampErrors === 0 ? "text-zinc-600" : "text-amber-400"}>{migrateResult.timestampErrors}</span></span>
                      <span className="ml-3">
                        Other: <span className="text-red-400">{migrateResult.before["Other"] ?? 0}</span>
                        {" → "}
                        <span className={migrateResult.after["Other"] === 0 ? "text-green-400" : "text-amber-400"}>{migrateResult.after["Other"] ?? 0}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {/* Demo data */}
              <div className="border-t border-zinc-800 pt-3">
                <p className="text-[10px] text-zinc-600 mb-2">Load sample data for testing. Will not appear by default on first load.</p>
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
          <ReportModal calls={calls} onClose={() => setShowReport(false)} />
        </Suspense>
      )}
    </div>
  );
}
