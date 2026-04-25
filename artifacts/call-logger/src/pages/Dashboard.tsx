import { useState, useMemo, useCallback } from "react";
import Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  SAMPLE_DATA,
  maskPhone,
  formatDuration,
  type CallRecord,
  type CallStatus,
} from "@/data/sampleData";

const STATUS_COLORS: Record<CallStatus, string> = {
  Answered: "#22c55e",
  "Call Ended": "#3b82f6",
  Missed: "#ef4444",
  Canceled: "#f97316",
  Voicemail: "#f59e0b",
};

const STATUS_TEXT_COLORS: Record<CallStatus, string> = {
  Answered: "text-green-400",
  "Call Ended": "text-blue-400",
  Missed: "text-red-400",
  Canceled: "text-orange-400",
  Voicemail: "text-amber-400",
};

function MetricCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="border border-zinc-700 bg-zinc-900 p-4 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">{label}</span>
      <span className={`text-3xl font-mono font-bold ${accent ?? "text-white"}`}>{value}</span>
      {sub && <span className="text-[11px] font-mono text-zinc-500">{sub}</span>}
    </div>
  );
}

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; fill?: string }>;
  label?: string | number;
};

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-zinc-600 bg-zinc-900 p-2 text-xs font-mono text-zinc-300">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.fill ?? "#fff" }}>
          {p.name ?? "Value"}: {p.value}
        </p>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 mb-3 border-b border-zinc-800 pb-1">{title}</p>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<CallRecord[]>(SAMPLE_DATA);
  const [csvInput, setCsvInput] = useState("");
  const [csvError, setCsvError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleString());
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [showMasked, setShowMasked] = useState(true);

  const filtered = useMemo(() => {
    let d = data;
    if (statusFilter !== "All") d = d.filter((r) => r.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      d = d.filter((r) => r.callerName.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q));
    }
    return d;
  }, [data, statusFilter, search]);

  const metrics = useMemo(() => {
    const total = data.length;
    const answered = data.filter((r) => r.status === "Answered" || r.status === "Call Ended").length;
    const missed = data.filter((r) => r.status === "Missed" || r.status === "Canceled").length;
    const voicemail = data.filter((r) => r.status === "Voicemail").length;

    const nameCounts: Record<string, number> = {};
    data.forEach((r) => { nameCounts[r.callerName] = (nameCounts[r.callerName] ?? 0) + 1; });
    const repeatCallers = Object.values(nameCounts).filter((c) => c > 1).length;
    const repeatCallCount = Object.entries(nameCounts).filter(([, c]) => c > 1).reduce((a, [, c]) => a + c, 0);

    const withDuration = data.filter((r) => r.durationSeconds > 0);
    const avgDuration = withDuration.length
      ? Math.round(withDuration.reduce((a, r) => a + r.durationSeconds, 0) / withDuration.length)
      : 0;
    const longestRecord = data.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a), data[0]);

    const hourCounts: Record<number, number> = {};
    data.forEach((r) => { hourCounts[r.hour] = (hourCounts[r.hour] ?? 0) + 1; });
    const peakHour = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0];
    const peakHourLabel = peakHour
      ? `${Number(peakHour[0]) % 12 || 12}${Number(peakHour[0]) >= 12 ? "PM" : "AM"}`
      : "N/A";

    return { total, answered, missed, voicemail, repeatCallers, repeatCallCount, avgDuration, longestRecord, peakHourLabel, nameCounts };
  }, [data]);

  const callsByHour = useMemo(() => {
    const map: Record<number, number> = {};
    for (let h = 8; h <= 17; h++) map[h] = 0;
    data.forEach((r) => { if (r.hour >= 8 && r.hour <= 17) map[r.hour] = (map[r.hour] ?? 0) + 1; });
    return Object.entries(map)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([h, count]) => ({
        hour: `${Number(h) % 12 || 12}${Number(h) >= 12 ? "pm" : "am"}`,
        count,
      }));
  }, [data]);

  const callsByStatus = useMemo(() => {
    const map: Partial<Record<CallStatus, number>> = {};
    data.forEach((r) => { map[r.status] = (map[r.status] ?? 0) + 1; });
    return Object.entries(map).map(([status, count]) => ({ status, count: count ?? 0, fill: STATUS_COLORS[status as CallStatus] }));
  }, [data]);

  const repeatCallerChart = useMemo(() => {
    return Object.entries(metrics.nameCounts)
      .filter(([, c]) => c > 1)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, count]) => ({ name: name.split(" ")[0], count }));
  }, [metrics.nameCounts]);

  const longestCallsChart = useMemo(() => {
    return [...data]
      .filter((r) => r.durationSeconds > 0)
      .sort((a, b) => b.durationSeconds - a.durationSeconds)
      .slice(0, 8)
      .map((r) => ({ name: r.callerName.split(" ")[0], seconds: r.durationSeconds, label: r.duration }));
  }, [data]);

  const callsByDay = useMemo(() => {
    const map: Record<string, number> = {};
    data.forEach((r) => { map[r.date] = (map[r.date] ?? 0) + 1; });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => {
        const d = new Date(date + "T00:00:00");
        return { day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count };
      });
  }, [data]);

  const followUpTargets = useMemo(() => {
    const flagged = data.filter(
      (r) => r.status === "Missed" || r.status === "Voicemail" || r.notes.toLowerCase().includes("follow")
    );
    const countByName: Record<string, number> = {};
    flagged.forEach((r) => { countByName[r.callerName] = (countByName[r.callerName] ?? 0) + 1; });
    return Object.entries(countByName)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));
  }, [data]);

  const summary = useMemo(() => {
    const followUpCount = data.filter(
      (r) => r.status === "Missed" || r.status === "Voicemail" || r.notes.toLowerCase().includes("follow")
    ).length;
    const longestName = metrics.longestRecord?.callerName ?? "N/A";
    const longestDur = metrics.longestRecord?.duration ?? "0s";
    return `Hotline activity peaked at ${metrics.peakHourLabel}. ${followUpCount} call${followUpCount !== 1 ? "s" : ""} need follow-up. Repeat callers made up ${metrics.repeatCallCount} call${metrics.repeatCallCount !== 1 ? "s" : ""}. Longest call was ${longestDur} (${longestName}).`;
  }, [data, metrics]);

  const handleLoadCSV = useCallback(() => {
    setCsvError("");
    const text = csvInput.trim();
    if (!text) { setCsvError("No CSV content provided."); return; }
    const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    if (result.errors.length) { setCsvError("CSV parse error: " + result.errors[0].message); return; }
    const rows = result.data;
    if (!rows.length) { setCsvError("No rows found in CSV."); return; }
    const parsed: CallRecord[] = rows.map((row) => {
      const name = row["Name"] ?? row["callerName"] ?? "";
      const number = (row["Number"] ?? row["phoneNumber"] ?? "").replace(/\D/g, "");
      const date = row["Date"] ?? row["date"] ?? "";
      const time = row["Time"] ?? row["time"] ?? "";
      const durationRaw = row["Duration"] ?? row["duration"] ?? "0s";
      const status = (row["Status"] ?? row["status"] ?? "Answered") as CallStatus;
      const notes = row["Notes"] ?? row["notes"] ?? "";

      let durationSeconds = 0;
      const mMatch = durationRaw.match(/(\d+)m/);
      const sMatch = durationRaw.match(/(\d+)s/);
      if (mMatch) durationSeconds += parseInt(mMatch[1]) * 60;
      if (sMatch) durationSeconds += parseInt(sMatch[1]);
      if (!mMatch && !sMatch && /^\d+$/.test(durationRaw)) durationSeconds = parseInt(durationRaw);

      const timeParts = time.split(":");
      const hour = timeParts.length ? parseInt(timeParts[0]) : 0;

      return {
        callerName: name,
        phoneNumber: number,
        maskedNumber: maskPhone(number),
        date,
        time,
        hour,
        durationSeconds,
        duration: formatDuration(durationSeconds),
        status,
        notes,
      };
    });
    setData(parsed);
    setLastUpdated(new Date().toLocaleString());
    setCsvInput("");
  }, [csvInput]);

  const handleSampleData = useCallback(() => {
    setData(SAMPLE_DATA);
    setCsvInput("");
    setCsvError("");
    setLastUpdated(new Date().toLocaleString());
  }, []);

  const handleClear = useCallback(() => {
    setData([]);
    setCsvInput("");
    setCsvError("");
    setLastUpdated(new Date().toLocaleString());
  }, []);

  const STATUSES: string[] = ["All", "Answered", "Call Ended", "Missed", "Canceled", "Voicemail"];

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
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest">
          Last updated: <span className="text-zinc-400">{lastUpdated}</span>
        </div>
      </header>

      <main className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto space-y-8">

        {/* METRIC CARDS */}
        <Section title="Overview">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-zinc-800">
            <MetricCard label="Total Calls" value={String(metrics.total)} accent="text-white" />
            <MetricCard label="Answered / Ended" value={String(metrics.answered)} accent="text-green-400" />
            <MetricCard label="Missed / Canceled" value={String(metrics.missed)} accent="text-red-400" />
            <MetricCard label="Voicemails" value={String(metrics.voicemail)} accent="text-amber-400" />
            <MetricCard label="Repeat Callers" value={String(metrics.repeatCallers)} sub={`${metrics.repeatCallCount} repeat calls`} accent="text-blue-400" />
            <MetricCard label="Avg Duration" value={formatDuration(metrics.avgDuration)} accent="text-zinc-300" />
            <MetricCard label="Longest Call" value={metrics.longestRecord?.duration ?? "N/A"} sub={metrics.longestRecord?.callerName} accent="text-zinc-300" />
            <MetricCard label="Peak Hour" value={metrics.peakHourLabel} accent="text-amber-400" />
          </div>
        </Section>

        {/* CHARTS ROW 1 */}
        <Section title="Call Volume">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Calls by Hour */}
            <div className="border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Calls by Hour</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={callsByHour} barCategoryGap="20%">
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" fill="#3b82f6" name="Calls" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Calls by Day */}
            <div className="border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Calls by Day</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={callsByDay} barCategoryGap="20%">
                  <XAxis dataKey="day" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" fill="#22c55e" name="Calls" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Section>

        {/* CHARTS ROW 2 */}
        <Section title="Status & Callers">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Calls by Status */}
            <div className="border border-zinc-700 bg-zinc-900 p-4 lg:col-span-1">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Calls by Status</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={callsByStatus}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    innerRadius={30}
                    stroke="none"
                    paddingAngle={2}
                  >
                    {callsByStatus.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    iconSize={8}
                    iconType="circle"
                    formatter={(value) => <span style={{ fontSize: 10, fontFamily: "monospace", color: "#a1a1aa" }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Repeat Callers */}
            <div className="border border-zinc-700 bg-zinc-900 p-4 lg:col-span-1">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Top Repeat Callers</p>
              {repeatCallerChart.length === 0 ? (
                <p className="text-xs text-zinc-600 mt-4">No repeat callers</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={repeatCallerChart} layout="vertical" barCategoryGap="20%">
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="count" fill="#8b5cf6" name="Calls" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Longest Calls */}
            <div className="border border-zinc-700 bg-zinc-900 p-4 lg:col-span-1">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Longest Calls</p>
              {longestCallsChart.length === 0 ? (
                <p className="text-xs text-zinc-600 mt-4">No calls with duration</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={longestCallsChart} layout="vertical" barCategoryGap="20%">
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={(props) => {
                      if (!props.active || !props.payload?.length) return null;
                      const row = longestCallsChart.find((r) => r.name === props.label);
                      return (
                        <div className="border border-zinc-600 bg-zinc-900 p-2 text-xs font-mono text-zinc-300">
                          <p className="text-zinc-400">{props.label}</p>
                          <p>{row?.label ?? ""}</p>
                        </div>
                      );
                    }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="seconds" fill="#f59e0b" name="Seconds" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Follow-up Targets */}
            <div className="border border-zinc-700 bg-zinc-900 p-4 lg:col-span-1">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">Follow-up Targets</p>
              {followUpTargets.length === 0 ? (
                <p className="text-xs text-zinc-600 mt-4">No follow-up targets</p>
              ) : (
                <div className="space-y-2 mt-1">
                  {followUpTargets.map((t, i) => (
                    <div key={i} className="flex items-center justify-between border border-zinc-700 px-3 py-2">
                      <span className="text-xs text-zinc-300">{t.name}</span>
                      <span className="text-xs font-bold text-amber-400 border border-amber-800 px-2 py-0.5">{t.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* SUMMARY PANEL */}
        <Section title="Summary">
          <div className="border border-amber-800/50 bg-amber-950/20 px-5 py-4">
            <p className="text-[10px] uppercase tracking-widest text-amber-600 mb-2">Auto-generated summary</p>
            <p className="text-sm text-amber-200 leading-relaxed">{summary}</p>
          </div>
        </Section>

        {/* CALL TABLE */}
        <Section title="Call Log">
          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            <div className="flex gap-1 flex-wrap">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`text-[10px] px-2 py-1 border uppercase tracking-widest font-mono transition-colors ${
                    statusFilter === s
                      ? "border-zinc-400 text-white bg-zinc-700"
                      : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-2 ml-auto items-center">
              <input
                type="text"
                placeholder="Search name or notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-xs font-mono bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-52"
              />
              <button
                onClick={() => setShowMasked(!showMasked)}
                className="text-[10px] px-2 py-1.5 border border-zinc-700 text-zinc-500 hover:border-zinc-500 uppercase tracking-widest font-mono"
              >
                {showMasked ? "Show #" : "Mask #"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto border border-zinc-700">
            <table className="w-full text-xs font-mono min-w-[700px]">
              <thead>
                <tr className="border-b border-zinc-700 bg-zinc-900">
                  {["Caller", "Number", "Date", "Time", "Duration", "Status", "Notes"].map((h) => (
                    <th key={h} className="text-left text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-zinc-600">No records match.</td>
                  </tr>
                )}
                {filtered.map((r, i) => (
                  <tr key={i} className={`border-b border-zinc-800 ${i % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/50"} hover:bg-zinc-800/60`}>
                    <td className="px-3 py-2 text-zinc-200">{r.callerName}</td>
                    <td className="px-3 py-2 text-zinc-400 tracking-wide">
                      {showMasked ? r.maskedNumber : r.phoneNumber}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{r.date}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.time}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.duration}</td>
                    <td className="px-3 py-2">
                      <span className={`${STATUS_TEXT_COLORS[r.status]} `}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-500 max-w-[220px] truncate">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-zinc-600 mt-2">{filtered.length} record{filtered.length !== 1 ? "s" : ""} shown</p>
        </Section>

        {/* CSV IMPORT */}
        <Section title="Import Data">
          <div className="border border-zinc-700 bg-zinc-900 p-5 space-y-3">
            <p className="text-[11px] text-zinc-500">
              Paste CSV with columns: <span className="text-zinc-400">Name, Number, Date, Time, Duration, Status, Notes</span>
            </p>
            <textarea
              value={csvInput}
              onChange={(e) => setCsvInput(e.target.value)}
              rows={6}
              placeholder={"Name,Number,Date,Time,Duration,Status,Notes\nJohn Doe,13235551234,2025-04-01,09:00,5m 30s,Answered,Follow-up needed"}
              className="w-full bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-300 placeholder-zinc-700 p-3 focus:outline-none focus:border-zinc-500 resize-y"
            />
            {csvError && (
              <p className="text-xs text-red-400 font-mono">{csvError}</p>
            )}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleLoadCSV}
                className="text-[11px] uppercase tracking-widest font-mono px-4 py-2 bg-blue-800 hover:bg-blue-700 text-white border border-blue-600 transition-colors"
              >
                Load CSV
              </button>
              <button
                onClick={handleSampleData}
                className="text-[11px] uppercase tracking-widest font-mono px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 border border-zinc-600 transition-colors"
              >
                Use Sample Data
              </button>
              <button
                onClick={handleClear}
                className="text-[11px] uppercase tracking-widest font-mono px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-700 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </Section>

      </main>

      <footer className="border-t border-zinc-800 px-6 py-3 mt-4">
        <p className="text-[10px] text-zinc-700 uppercase tracking-widest">Pacific Systems // Call Logger — All data is processed locally in your browser</p>
      </footer>
    </div>
  );
}
