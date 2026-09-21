"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Upload, Lock, RotateCcw, X, Check, Wallet, Search } from "lucide-react"
import { useFinOps } from "@/components/finops-provider"
import { useTheme } from "@/components/theme-provider"
import ModuleLock from "@/components/module-lock"
import { FilterChips } from "@/components/filter-chips"
import type { Employee } from "@/lib/seeds"
import type { ImportPreviewResult } from "@/app/api/payroll/import/route"
import type { VariablePayMonth } from "@/app/api/variable-pay/route"
import type { ApplyUploadSummary } from "@/lib/variable-pay-store"
import {
  VARIABLE_PAY_CATEGORIES,
  applyVariablePay,
  describeChanges,
  variablePayChanges,
  type VariablePayCategory,
  type VariablePayRow,
} from "@/lib/variable-pay"

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const fmt = (n: number) => n.toLocaleString("en-KE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

// Why the parser dropped a row, in the finance manager's words.
const SKIP_REASON_LABELS: Record<string, string> = {
  no_staff_no_or_name: "no staff number or name in the row",
  currency_value_not_a_name: "name column held a currency value",
  junk_row: "header, blank or junk row",
}

type Filter = "changed" | "unchanged" | VariablePayCategory

function readParams() {
  if (typeof window === "undefined") return { month: null as string | null, employee: null as string | null }
  const q = new URLSearchParams(window.location.search)
  const month = q.get("month")
  return { month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null, employee: q.get("employee") }
}

export default function VariablePayPage() {
  const { addAuditLog, currentUserRole, authLoading } = useFinOps()
  const { cardRadius, buttonRadius, accentBg } = useTheme()

  const [month, setMonthState] = useState(() => readParams().month ?? new Date().toISOString().slice(0, 7))
  const [focusEmployee] = useState(() => readParams().employee)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [ledger, setLedger] = useState<VariablePayMonth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter | null>(null)
  const [search, setSearch] = useState("")

  // A different month starts with no preview or apply result on screen.
  function setMonth(next: string) {
    setMonthState(next)
    setPreview(null)
    setApplied(null)
    setEditing(null)
  }

  // Upload → preview → apply
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [previewFile, setPreviewFile] = useState<string | null>(null)
  const [previewView, setPreviewView] = useState<"matched" | "unmatched" | "skipped" | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<ApplyUploadSummary | null>(null)

  // One cell being edited by hand
  const [editing, setEditing] = useState<{ id: string; category: VariablePayCategory } | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const [editNote, setEditNote] = useState("")
  const [saving, setSaving] = useState(false)

  async function loadAll(signal?: { ignore: boolean }) {
    setLoading(true)
    setError(null)
    try {
      const [empRes, vpRes] = await Promise.all([fetch("/api/employees"), fetch(`/api/variable-pay?month=${month}`)])
      const empJson = await empRes.json()
      const vpJson = await vpRes.json()
      if (!empRes.ok) throw new Error(empJson.error ?? "Could not load Employee Master")
      if (!vpRes.ok) throw new Error(vpJson.error ?? "Could not load variable pay")
      if (signal?.ignore) return
      setEmployees((empJson.employees ?? []) as Employee[])
      setLedger(vpJson as VariablePayMonth)
    } catch (err) {
      if (!signal?.ignore) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!signal?.ignore) setLoading(false)
    }
  }

  useEffect(() => {
    const signal = { ignore: false }
    loadAll(signal)
    return () => { signal.ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  // Scroll the deep-linked employee into view once the grid is on screen.
  useEffect(() => {
    if (loading || !focusEmployee) return
    const el = document.getElementById(`vp-row-${focusEmployee}`)
    el?.scrollIntoView({ block: "center", behavior: "smooth" })
    el?.classList.add("ring-2", "ring-amber-500")
    const t = setTimeout(() => el?.classList.remove("ring-2", "ring-amber-500"), 2500)
    return () => clearTimeout(t)
  }, [loading, focusEmployee])

  const rowsByEmployee = useMemo(() => {
    const map = new Map<string, VariablePayRow[]>()
    for (const r of ledger?.rows ?? []) map.set(r.employee_id, [...(map.get(r.employee_id) ?? []), r])
    return map
  }, [ledger])

  const perEmployee = useMemo(
    () => employees.map((emp) => {
      const rows = rowsByEmployee.get(emp.id) ?? []
      return { emp, rows, effective: applyVariablePay(emp, rows), changes: variablePayChanges(emp, rows) }
    }),
    [employees, rowsByEmployee],
  )

  const changedCount = perEmployee.filter((p) => p.changes.length > 0).length
  const categoryCounts = useMemo(() => {
    const counts = new Map<VariablePayCategory, number>()
    for (const p of perEmployee) for (const c of p.changes) counts.set(c.category, (counts.get(c.category) ?? 0) + 1)
    return counts
  }, [perEmployee])
  const totals = useMemo(() => {
    let earnings = 0, deductions = 0
    for (const p of perEmployee) for (const c of p.changes) {
      if (c.kind === "deduction") deductions += c.delta
      else earnings += c.delta
    }
    return { earnings, deductions }
  }, [perEmployee])

  const filterOptions = useMemo(() => {
    const opts: Array<{ key: Filter; label: string; count: number }> = [
      { key: "changed", label: "with changes", count: changedCount },
      { key: "unchanged", label: "standard pay, no changes", count: perEmployee.length - changedCount },
    ]
    for (const cat of VARIABLE_PAY_CATEGORIES) {
      const n = categoryCounts.get(cat.key) ?? 0
      if (n > 0) opts.push({ key: cat.key, label: cat.label, count: n })
    }
    return opts
  }, [perEmployee.length, changedCount, categoryCounts])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return perEmployee.filter((p) => {
      if (q && !(`${p.emp.id} ${p.emp.name}`.toLowerCase().includes(q))) return false
      if (!filter) return true
      if (filter === "changed") return p.changes.length > 0
      if (filter === "unchanged") return p.changes.length === 0
      return p.changes.some((c) => c.category === filter)
    })
  }, [perEmployee, filter, search])

  // Columns: every category, so any kind of variable pay can be entered.
  const columns = VARIABLE_PAY_CATEGORIES

  const locked = ledger?.locked ?? false

  // ── upload ────────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    setImporting(true)
    setError(null)
    setApplied(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/payroll/import", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Could not read the sheet")
      setPreview(json as ImportPreviewResult)
      setPreviewFile(file.name)
      setPreviewView(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  async function applyPreview() {
    if (!preview) return
    setApplying(true)
    setError(null)
    try {
      const res = await fetch("/api/variable-pay/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          rows: preview.matched.map((m) => m.parsed),
          categories: preview.categories,
          sourceFile: previewFile,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Could not apply the sheet")
      const summary = json as ApplyUploadSummary
      setApplied(summary)
      setPreview(null)
      addAuditLog(
        "VARIABLE PAY UPLOADED",
        month,
        `${previewFile ?? "sheet"}: ${summary.stored} override(s) stored, ${summary.cleared} cleared, ${summary.matched.length} employees matched, ${summary.unmatched.length} unmatched.`,
      )
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  // ── manual edit ───────────────────────────────────────────────────────
  function startEdit(id: string, category: VariablePayCategory, current: number, note: string | null | undefined) {
    if (locked) return
    setEditing({ id, category })
    setEditAmount(String(current))
    setEditNote(note ?? "")
  }

  async function saveEdit(clear: boolean) {
    if (!editing) return
    const amount = clear ? null : Number(editAmount)
    if (!clear && !Number.isFinite(amount)) { setError("Enter a number."); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/variable-pay", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, employee_id: editing.id, category: editing.category, amount, note: editNote }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Could not save")
      const label = VARIABLE_PAY_CATEGORIES.find((c) => c.key === editing.category)?.label ?? editing.category
      addAuditLog(
        clear ? "VARIABLE PAY CLEARED" : "VARIABLE PAY SET",
        `${editing.id} · ${month}`,
        clear ? `${label} reset to the standard value.` : `${label} set to KES ${fmt(amount as number)}${editNote ? ` — ${editNote}` : ""}.`,
        clear ? undefined : (amount as number),
      )
      setEditing(null)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!authLoading && currentUserRole !== "finance_manager") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
        <Lock className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
        <h1 className="text-sm font-bold font-mono uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Access Restricted</h1>
        <p className="text-zinc-400 text-xs max-w-sm">Variable pay is salary data restricted to the Finance Manager role.</p>
      </div>
    )
  }

  const previewTotal = preview ? preview.matched.length + preview.unmatched.length + preview.skipped.length : 0

  return (
    <ModuleLock moduleName="Variable Pay">
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-3 border-b border-zinc-200 dark:border-zinc-900 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="text-base font-bold font-mono uppercase tracking-wider">Variable Pay</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-xs max-w-2xl">
            Everything that varies from an employee&apos;s standard pay in a month — bonuses, overtime, arrears, advances, loans
            and the rest. Upload the month&apos;s sheet or type figures in; the payroll run for the month uses these
            instead of the Employee Master values. Where nothing is entered, standard pay applies.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="vp-month" className="text-[9px] font-mono uppercase tracking-wider text-zinc-400">Month</label>
          <select
            id="vp-month"
            value={month.slice(5, 7)}
            onChange={(e) => setMonth(`${month.slice(0, 4)}-${e.target.value}`)}
            className={`bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[11px] font-mono focus:outline-none ${buttonRadius}`}
          >
            {MONTH_NAMES.map((label, i) => <option key={label} value={String(i + 1).padStart(2, "0")}>{label}</option>)}
          </select>
          <select
            aria-label="Year"
            value={month.slice(0, 4)}
            onChange={(e) => setMonth(`${e.target.value}-${month.slice(5, 7)}`)}
            className={`bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[11px] font-mono focus:outline-none ${buttonRadius}`}
          >
            {Array.from({ length: new Date().getFullYear() + 1 - 2024 + 1 }, (_, i) => String(2024 + i)).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <label
            className={`px-2.5 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 cursor-pointer ${accentBg} ${buttonRadius} ${importing || locked ? "opacity-50 pointer-events-none" : ""}`}
            title={locked ? "This month's run is locked" : "Upload the month's variable-pay sheet (.xlsx)"}
          >
            <Upload className="h-3.5 w-3.5" /><span>{importing ? "Reading…" : `Upload ${monthLabel(month)} sheet`}</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }} />
          </label>
          <Link href={`/payroll`} className={`px-2.5 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}>
            <Wallet className="h-3.5 w-3.5" /><span>Payroll</span>
          </Link>
        </div>
      </div>

      {locked && (
        <div className="p-3 border border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-900 text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5" />
          The {monthLabel(month)} payroll run is <b className="font-mono">{ledger?.runStatus}</b> — variable pay for this month is locked. Reject the run to reopen it.
        </div>
      )}
      {!locked && ledger?.runStatus === "Draft" && (
        <div className="p-3 border border-zinc-200 bg-zinc-50/60 dark:bg-zinc-900/30 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400">
          A Draft run exists for {monthLabel(month)}. Changes made here take effect when you run payroll again.
        </div>
      )}
      {error && (
        <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">{error}</div>
      )}

      {/* Upload preview */}
      {preview && (
        <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-3 ${cardRadius}`}>
          <div className="flex items-center justify-between border-b dark:border-zinc-900 pb-2">
            <h3 className="text-xs font-mono uppercase tracking-wider font-bold">Sheet preview — {previewFile}</h3>
            <button onClick={() => setPreview(null)} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
          </div>
          <p className="text-[10px] font-mono text-zinc-500">
            Columns recognised: {preview.categories.length > 0
              ? preview.categories.map((c) => VARIABLE_PAY_CATEGORIES.find((d) => d.key === c)?.label ?? c).join(" · ")
              : <span className="text-rose-500">none — check the column headers</span>}
          </p>
          <FilterChips
            options={[
              { key: "matched", label: "matched", count: preview.matched.length },
              { key: "unmatched", label: "unmatched (not in Employee Master)", count: preview.unmatched.length },
              { key: "skipped", label: "rows skipped", count: preview.skipped.length },
            ]}
            active={previewView} onChange={setPreviewView} total={previewTotal} allLabel="Rows read" tone="neutral"
          />
          {preview.basicDifferences.length > 0 && (
            <div className="p-2.5 border border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-900 text-[10px] font-mono text-amber-700 dark:text-amber-400 space-y-1">
              <p className="font-bold uppercase tracking-wider">Basic salary differs from Employee Master for {preview.basicDifferences.length} — not applied</p>
              <p>Basic is standard pay, not variable pay. If these are raises, update them in Employee Master.</p>
              {preview.basicDifferences.slice(0, 8).map((b) => (
                <p key={b.employeeId}>{b.employeeId}: master {fmt(b.master)} → sheet {fmt(b.sheet)}{" "}
                  <Link href={`/employees?edit=${b.employeeId}&field=base_salary`} className="underline underline-offset-2">Update →</Link>
                </p>
              ))}
              {preview.basicDifferences.length > 8 && <p>…and {preview.basicDifferences.length - 8} more.</p>}
            </div>
          )}
          <div className="max-h-48 overflow-y-auto border-t dark:border-zinc-900 pt-2 text-[10px] font-mono space-y-1">
            {(previewView === null || previewView === "matched") && preview.matched.map((m) => (
              <div key={`m-${m.parsed.id}`} className="flex justify-between gap-3 text-zinc-500">
                <span><span className="text-emerald-600">✓</span> {m.parsed.id} · {m.existingName}</span>
                <span className="text-zinc-400">
                  {preview.categories.filter((c) => (m.parsed.variable[c] ?? 0) !== 0)
                    .map((c) => `${VARIABLE_PAY_CATEGORIES.find((d) => d.key === c)?.label} ${fmt(m.parsed.variable[c] ?? 0)}`).join(" · ") || "all zero"}
                </span>
              </div>
            ))}
            {(previewView === null || previewView === "unmatched") && preview.unmatched.map((u) => (
              <div key={`u-${u.parsed.id}`} className="flex justify-between gap-3 text-amber-600 dark:text-amber-400">
                <span>{u.parsed.id} · {u.parsed.name || "(no name)"} — not in Employee Master</span>
                <Link href={`/employees?add=${encodeURIComponent(u.parsed.id)}&name=${encodeURIComponent(u.parsed.name ?? "")}&basic=${u.parsed.baseSalary}`}
                  className="uppercase tracking-wider underline underline-offset-2 whitespace-nowrap">Add →</Link>
              </div>
            ))}
            {(previewView === null || previewView === "skipped") && preview.skipped.map((sk) => (
              <div key={`s-${sk.row}`} className="flex justify-between text-zinc-400"><span>Row {sk.row}</span><span>{SKIP_REASON_LABELS[sk.reason] ?? sk.reason}</span></div>
            ))}
          </div>
          <button
            onClick={applyPreview}
            disabled={applying || locked || preview.matched.length === 0 || preview.categories.length === 0}
            className={`w-full py-2 font-mono text-[10px] uppercase tracking-wider font-bold disabled:opacity-50 ${accentBg} ${buttonRadius}`}
          >
            {applying ? "Applying…" : `Apply ${preview.matched.length} matched rows to ${monthLabel(month)}`}
          </button>
          <p className="text-[9px] font-mono text-zinc-400">
            Only the columns above are written. A value equal to the employee&apos;s standard pay is not stored as a change.
          </p>
        </div>
      )}

      {applied && (
        <div className="p-3 border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-900 text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
          <Check className="h-3.5 w-3.5" />
          Applied {applied.sourceFile ?? "sheet"}: {applied.stored} change(s) stored, {applied.cleared} reset to standard, {applied.matched.length} employees matched
          {applied.unmatched.length > 0 && <>, {applied.unmatched.length} not in Employee Master (not applied)</>}.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Employees", value: String(perEmployee.length) },
          { label: "With changes this month", value: String(changedCount) },
          { label: "Earnings vs standard", value: (totals.earnings >= 0 ? "+" : "−") + fmt(Math.abs(totals.earnings)) },
          { label: "Deductions vs standard", value: (totals.deductions >= 0 ? "+" : "−") + fmt(Math.abs(totals.deductions)) },
        ].map((card) => (
          <div key={card.label} className={`p-4 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 flex flex-col justify-between h-16 ${cardRadius}`}>
            <span className="text-[9px] font-mono uppercase text-zinc-400">{card.label}</span>
            <span className="text-sm font-bold font-mono text-zinc-800 dark:text-zinc-100">{card.value}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className={`border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 overflow-hidden ${cardRadius}`}>
        <div className="px-5 py-3 border-b dark:border-zinc-900 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-mono uppercase tracking-wider font-bold">{monthLabel(month)} — {visible.length} of {perEmployee.length} employees</h3>
            <label className="flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 px-2 py-1">
              <Search className="h-3 w-3 text-zinc-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Staff no or name"
                className="bg-transparent text-[11px] font-mono focus:outline-none w-40" />
            </label>
          </div>
          <FilterChips options={filterOptions} active={filter} onChange={setFilter} total={perEmployee.length} tone="amber" />
        </div>

        {loading ? (
          <div className="p-5 text-[10px] font-mono uppercase text-zinc-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1400px]">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-900 text-zinc-400 font-mono text-[9px] uppercase tracking-wider">
                  <th className="px-4 py-2.5 sticky left-0 bg-zinc-50 dark:bg-zinc-900/60">Employee</th>
                  {columns.map((c) => (
                    <th key={c.key} className="px-3 py-2.5 text-right whitespace-nowrap" title={c.kind === "deduction" ? "Deduction" : c.kind === "non_cash" ? "Non-cash benefit" : "Earning"}>
                      {c.label}{c.kind === "deduction" ? " (−)" : ""}
                    </th>
                  ))}
                  <th className="px-4 py-2.5">This month vs standard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900 text-[11px]">
                {visible.map(({ emp, rows, effective, changes }) => (
                  <tr key={emp.id} id={`vp-row-${emp.id}`} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20">
                    <td className="px-4 py-2 sticky left-0 bg-white dark:bg-zinc-950">
                      <p className="font-semibold text-zinc-800 dark:text-zinc-200 whitespace-nowrap">{emp.name}</p>
                      <span className="text-[9px] text-zinc-400 font-mono">{emp.id} · CC {emp.cost_centre}</span>
                    </td>
                    {columns.map((c) => {
                      const row = rows.find((r) => r.category === c.key)
                      const standard = Number(emp[c.key] ?? 0)
                      const value = Number(effective[c.key] ?? 0)
                      const changed = changes.some((ch) => ch.category === c.key)
                      const isEditing = editing?.id === emp.id && editing.category === c.key
                      if (isEditing) {
                        return (
                          <td key={c.key} className="px-2 py-1 bg-amber-50 dark:bg-amber-950/30" colSpan={1}>
                            <div className="flex flex-col gap-1 min-w-[150px]">
                              <input autoFocus type="number" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(false); if (e.key === "Escape") setEditing(null) }}
                                className="w-full bg-white dark:bg-zinc-900 border border-amber-300 px-1.5 py-0.5 text-[11px] font-mono text-right focus:outline-none" />
                              <input value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="note (optional)"
                                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(false); if (e.key === "Escape") setEditing(null) }}
                                className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 text-[10px] focus:outline-none" />
                              <div className="flex gap-1">
                                <button disabled={saving} onClick={() => saveEdit(false)} className={`flex-1 py-0.5 text-[9px] font-mono uppercase font-bold ${accentBg} ${buttonRadius}`}>Save</button>
                                <button disabled={saving} onClick={() => saveEdit(true)} title="Back to the standard value"
                                  className={`px-1.5 py-0.5 text-[9px] font-mono uppercase border border-zinc-300 dark:border-zinc-700 ${buttonRadius}`}><RotateCcw className="h-3 w-3" /></button>
                                <button disabled={saving} onClick={() => setEditing(null)} className={`px-1.5 py-0.5 text-[9px] font-mono uppercase border border-zinc-300 dark:border-zinc-700 ${buttonRadius}`}><X className="h-3 w-3" /></button>
                              </div>
                              <span className="text-[9px] text-zinc-400 font-mono">standard {fmt(standard)}</span>
                            </div>
                          </td>
                        )
                      }
                      return (
                        <td key={c.key} className={`px-1 py-1 text-right font-mono ${changed ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => startEdit(emp.id, c.key, value, row?.note)}
                            title={locked ? "Locked" : changed ? `Standard ${fmt(standard)}${row?.note ? ` · ${row.note}` : ""} — click to edit` : "Click to enter a figure for this month"}
                            className={`w-full px-2 py-1 text-right ${changed ? "text-amber-800 dark:text-amber-300 font-bold" : value === 0 ? "text-zinc-300 dark:text-zinc-700" : "text-zinc-600 dark:text-zinc-400"} ${locked ? "cursor-default" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"} ${buttonRadius}`}
                          >
                            {fmt(value)}
                          </button>
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-[10px]">
                      {changes.length === 0 ? (
                        <span className="text-zinc-400">No changes — standard pay</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">{describeChanges(changes)}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={columns.length + 2} className="px-4 py-6 text-center text-[10px] font-mono uppercase text-zinc-400">No employees match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </ModuleLock>
  )
}
