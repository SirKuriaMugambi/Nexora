"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useFinOps } from "@/components/finops-provider"
import { useTheme } from "@/components/theme-provider"
import {
  Wallet, CheckCircle2, FileSpreadsheet, Eye,
  Download, Upload, ChevronDown, ChevronUp, Building2,
  Calculator, TrendingUp, Users, DollarSign, X, RotateCcw, IdCard, Lock, Mail
} from "lucide-react"
import {
  computePayroll,
  buildCostCentreBreakdown,
  buildMasterRegisterCSV,
  type EmployeeSummary,
} from "@/lib/payroll-engine"
import { buildPayrollJournal } from "@/lib/journal-builder"
import { validatePayrollRows } from "@/lib/payroll-validation"
import ModuleLock from "@/components/module-lock"
import type { Employee } from "@/lib/seeds"
import type { ImportPreviewResult } from "@/app/api/payroll/import/route"

// ── helpers ─────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString("en-KE", { maximumFractionDigits: 0 })
}
function fmtD(n: number) {
  return n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
/**
 * Saves a blob to disk. Two details matter and were previously wrong
 * everywhere on this page:
 *  - the anchor must be IN the document for .click() to fire reliably
 *    (a detached anchor is ignored by some browsers), and
 *  - the object URL must NOT be revoked synchronously after .click().
 *    The browser hasn't finished reading the blob at that point, so
 *    revoking immediately cancels the download — which looked like
 *    "nothing happened", so the button got clicked again, and every
 *    click that did survive queued another Save-As prompt.
 */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function downloadCSV(content: string, filename: string) {
  // Leading BOM so Excel reads the file as UTF-8 rather than Windows-1252
  // (without it, em-dashes and accented names render as mojibake).
  triggerDownload(new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" }), filename)
}

// Derive a full EmployeeSummary from an Employee object
function toSummary(emp: Employee): EmployeeSummary {
  return {
    id: emp.id, name: emp.name, kra_pin: emp.kra_pin ?? "",
    cost_centre: emp.cost_centre ?? "121",
    gross_salary: emp.gross_salary ?? emp.base_salary + emp.allowances,
    net_paye: emp.net_paye ?? emp.paye,
    nssf_t1: emp.nssf_t1 ?? 420, nssf_t2: emp.nssf_t2 ?? 1740,
    shif: emp.shif ?? emp.nhif,
    ahl: emp.ahl ?? 0,
    defined_pension_ee: emp.defined_pension_ee ?? 0,
    defined_pension_er: emp.defined_pension_er ?? 0,
    helb: emp.helb ?? 0,
    company_loan: emp.company_loan ?? 0,
    bank_loan: emp.bank_loan ?? 0,
    sacco: emp.sacco ?? 0,
    advances: emp.advances ?? 0,
    net_salary: emp.net_salary,
  }
}

// ── PAYE band visual helper ──────────────────────────────────────────────────
const BANDS = [
  { label: "≤ 24K", rate: "10%", range: "0 – 24,000" },
  { label: "24K–32K", rate: "25%", range: "24,001 – 32,333" },
  { label: "32K–500K", rate: "30%", range: "32,334 – 500,000" },
  { label: "500K–800K", rate: "32.5%", range: "500,001 – 800,000" },
  { label: "> 800K", rate: "35%", range: "800,001+" },
]

// ── PAYSLIP PANEL ────────────────────────────────────────────────────────────
function PayslipPanel({ emp, onClose }: {
  emp: Employee; onClose: () => void
}) {
  // Mirrors the real Chrysal payslip layout (same sectioned format as the
  // emailed PDF in lib/payroll-backend.ts): Earnings / Deductions / Net Pay /
  // PAYE Information with green section headers and per-section subtotals.
  // Figures stay on the engine's verified Nov-2024 basis (taxable pay =
  // gross − NSSF − pension), matching the PDF — format matched, calculation
  // basis intentionally left as-is per instruction.
  const fmt2 = (n: number) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const earnings: [string, number][] = [
    ["Basic Pay", emp.base_salary],
    ...(emp.bonus_commission > 0 ? [["Bonus / Commission", emp.bonus_commission] as [string, number]] : []),
    ...(emp.transport_allowance > 0 ? [["Transport Allowance", emp.transport_allowance] as [string, number]] : []),
    ...(emp.fringe_benefit > 0 ? [["Fringe Benefit (FBT)", emp.fringe_benefit] as [string, number]] : []),
    ...(emp.arrears > 0 ? [["Arrears", emp.arrears] as [string, number]] : []),
    ...(emp.ot_other > 0 ? [["OT / Other", emp.ot_other] as [string, number]] : []),
  ]

  const deductions: [string, number][] = [
    ["PAYE", emp.net_paye ?? emp.paye],
    ["NSSF (Tier I)", emp.nssf_t1 ?? 420],
    ["NSSF (Tier II)", emp.nssf_t2 ?? 1740],
    ["SHIF", emp.shif ?? emp.nhif],
    ["Housing Levy", emp.ahl ?? 0],
    ["Pension Contribution", emp.defined_pension_ee ?? 0],
    ...(emp.voluntary_pension > 0 ? [["Voluntary Pension", emp.voluntary_pension] as [string, number]] : []),
    ...(emp.advances > 0 ? [["Advances", emp.advances] as [string, number]] : []),
    ...(emp.helb > 0 ? [["HELB", emp.helb] as [string, number]] : []),
    ...(emp.company_loan > 0 ? [["Company Loan", emp.company_loan] as [string, number]] : []),
    ...(emp.bank_loan > 0 ? [["Bank Loan", emp.bank_loan] as [string, number]] : []),
    ...(emp.sacco > 0 ? [["SACCO", emp.sacco] as [string, number]] : []),
  ]
  const deductionsTotal = deductions.reduce((s, [, amount]) => s + amount, 0)

  const sectionHeader = "font-bold text-emerald-700 dark:text-emerald-500"
  const row = (label: string, amount: number, key: string, indent = false) => (
    <div key={key} className={`flex justify-between ${indent ? "pl-3" : ""}`}>
      <span>{label}</span><span>{fmt2(amount)}</span>
    </div>
  )

  return (
    <div className="space-y-4 text-[11px]">
      <div className="flex justify-between items-center pb-2 border-b dark:border-zinc-900">
        <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase">Monthly Payslip</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
      </div>

      <div className="font-mono p-4 border border-zinc-150 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/10 space-y-3">
        <div className="text-center pb-1">
          <h4 className="font-bold text-zinc-900 dark:text-zinc-50">CHRYSAL AFRICA LTD</h4>
          <span className={`text-[10px] ${sectionHeader}`}>Payslip</span>
        </div>

        <div className="text-[9px] space-y-0.5 text-zinc-500">
          <div><strong>Employee No.:</strong> {emp.id}</div>
          <div><strong>Name:</strong> {emp.name}</div>
          <div><strong>Pay Period:</strong> {new Date().toLocaleString("en-KE", { month: "long", year: "numeric" })}</div>
          <div><strong>Admin. Unit:</strong> {emp.department ?? "—"}</div>
          <div><strong>Currency:</strong> KES</div>
        </div>

        <div className="space-y-1 text-[10px]">
          <div className={sectionHeader}>Earnings:</div>
          {earnings.map(([label, amount], i) => row(label, amount, `earn-${i}`))}
          <div className="flex justify-between font-bold border-t dark:border-zinc-800 pt-0.5">
            <span /><span>{fmt2(emp.gross_salary ?? 0)}</span>
          </div>
        </div>

        <div className="space-y-1 text-[10px]">
          <div className={sectionHeader}>Deductions:</div>
          {deductions.map(([label, amount], i) => row(label, amount, `ded-${i}`))}
          <div className="flex justify-between font-bold border-t dark:border-zinc-800 pt-0.5">
            <span /><span>{fmt2(deductionsTotal)}</span>
          </div>
        </div>

        <div className="flex justify-between text-sm font-bold border-t dark:border-zinc-700 pt-2">
          <span>Net Pay</span>
          <span>{fmt2(emp.net_salary)}</span>
        </div>

        <div className="space-y-1 text-[10px] border-t dark:border-zinc-800 pt-2">
          <div className={sectionHeader}>PAYE Information:</div>
          {row("Total Earnings", emp.gross_salary ?? 0, "paye-gross")}
          <div>Less Pre-Tax Deductions:</div>
          {row("NSSF (Tier I)", emp.nssf_t1 ?? 420, "paye-nssf1", true)}
          {row("NSSF (Tier II)", emp.nssf_t2 ?? 1740, "paye-nssf2", true)}
          {row("Pension Contribution", emp.defined_pension_ee ?? 0, "paye-pension", true)}
          <div className="flex justify-between font-bold"><span>Taxable Pay</span><span>{fmt2(emp.taxable_pay ?? 0)}</span></div>
          {row("Personal Relief", emp.personal_relief ?? 2400, "paye-relief")}
          {row("PAYE", emp.net_paye ?? emp.paye, "paye-net")}
        </div>
      </div>
    </div>
  )
}

// ── MAIN PAGE ────────────────────────────────────────────────────────────────
type Tab = "register" | "statutory" | "gl" | "calculator"

type RunStatus = "Draft" | "Submitted" | "Approved" | "Rejected" | "Posted" | null

export default function PayrollPage() {
  const { addAuditLog, currentUserRole, authLoading } = useFinOps()
  const { cardRadius, buttonRadius, accentBg, accentText, accentBadge } = useTheme()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>("register")
  const [runStatus, setRunStatus] = useState<RunStatus>(null)
  const [workflowBusy, setWorkflowBusy] = useState(false)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [activeEmpIdx, setActiveEmpIdx] = useState<number | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  // The pay period being worked on. Defaults to the current calendar month
  // (the normal end-of-month run) but is explicitly selectable: payroll that
  // slips into the next month, or a correction to an earlier period, must
  // still be filed against the month it belongs to — not whatever month it
  // happens to be processed in.
  const [apiMonth, setApiMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const payMonth = useMemo(() => {
    const [year, month] = apiMonth.split("-").map(Number)
    return new Date(year, (month ?? 1) - 1, 1).toLocaleString("en-KE", { month: "long", year: "numeric" })
  }, [apiMonth])
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), [])

  // Which file-generating action is currently running, so its button can
  // disable itself and show progress. Generating 46 payslip PDFs server-side
  // takes a few seconds; without this the button looked inert and got
  // clicked repeatedly, queueing a Save-As prompt per click.
  const [busyAction, setBusyAction] = useState<string | null>(null)

  // Send-payslips-by-email state
  const [sendingPayslips, setSendingPayslips] = useState(false)
  const [sendPayslipsResult, setSendPayslipsResult] = useState<{
    sent: string[]; skippedNoEmail: string[]; failed: Array<{ id: string; error: string }>
  } | null>(null)

  // AX journal posting state
  const [postingToAx, setPostingToAx] = useState(false)
  const [axJournal, setAxJournal] = useState<{
    lines: Array<{ lineNumber: number; accountCode: string; accountName: string; debit: number; credit: number; dimension: { department: string; costCentre: string }; description: string }>
    totalDebit: number
    totalCredit: number
    isBalanced: boolean
  } | null>(null)
  const [axResult, setAxResult] = useState<{ success: boolean; isMock: boolean; journalNumber: string; message: string } | null>(null)
  const [axError, setAxError] = useState<string | null>(null)

  // Calculator state
  const [calcInputs, setCalcInputs] = useState({
    basic: 0, bonus: 0, fbt: 0, transport: 0, arrears: 0, ot: 0,
    voluntary_pension: 0, advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0
  })

  // Variable-pay import (One-Click Calculation) state
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null)

  // Re-runs whenever the selected pay period changes, so the workflow status
  // (Draft/Submitted/Approved/Posted) always reflects the month on screen.
  useEffect(() => {
    let ignore = false

    async function loadEmployees() {
      try {
        const response = await fetch(`/api/payroll?month=${apiMonth}`)
        if (!response.ok) {
          throw new Error("Unable to load employees")
        }

        const payload = (await response.json()) as { employees?: Employee[]; run?: { status: RunStatus } | null }
        if (!ignore && Array.isArray(payload.employees)) {
          setEmployees(payload.employees)
          setRunStatus(payload.run?.status ?? null)
        }
      } catch {
        if (!ignore) {
          setEmployees([])
        }
      } finally {
        if (!ignore) {
          setLoadingEmployees(false)
        }
      }
    }

    loadEmployees()
    return () => {
      ignore = true
    }
  }, [apiMonth])

  // Aggregated data
  const summaries = useMemo(() => employees.map(toSummary), [employees])

  // Pre-flight checks — errors block Run Payroll (the API enforces the same
  // rules server-side); warnings flag degraded outputs (bank file, email).
  const validationIssues = useMemo(() => validatePayrollRows(employees), [employees])
  const validationErrors = useMemo(() => validationIssues.filter((i) => i.severity === "error"), [validationIssues])
  const validationWarnings = useMemo(() => validationIssues.filter((i) => i.severity === "warning"), [validationIssues])

  // The real Dr/Cr journal, built client-side from the same pure function the
  // server uses for Post-to-AX and the CSV download — so the GL tab shows the
  // actual balanced entry before posting, not a separate hand-written summary.
  const previewJournal = useMemo(
    () =>
      buildPayrollJournal(
        apiMonth,
        employees.map((emp) => ({
          employee: { id: emp.id, department: emp.department, cost_centre: emp.cost_centre },
          inputs: {
            base_salary: emp.base_salary,
            bonus_commission: emp.bonus_commission,
            fringe_benefit: emp.fringe_benefit,
            transport_allowance: emp.transport_allowance,
            arrears: emp.arrears,
            ot_other: emp.ot_other,
            voluntary_pension: emp.voluntary_pension,
            advances: emp.advances,
            helb: emp.helb,
            company_loan: emp.company_loan,
            bank_loan: emp.bank_loan,
            sacco: emp.sacco,
          },
          result: { ...emp, total_deductions: emp.deductions },
        })),
      ),
    [employees, apiMonth],
  )

  const totals = useMemo(() => {
    return employees.reduce((acc, emp) => {
      acc.headcount += 1
      acc.gross += emp.gross_salary ?? (emp.base_salary + emp.allowances)
      acc.nssf += (emp.nssf_t1 ?? 420) + (emp.nssf_t2 ?? 1740)
      acc.shif += emp.shif ?? emp.nhif
      acc.ahl += emp.ahl ?? 0
      acc.paye += emp.net_paye ?? emp.paye
      acc.pension_ee += emp.defined_pension_ee ?? 0
      acc.pension_er += emp.defined_pension_er ?? 0
      acc.deductions += emp.deductions
      acc.net += emp.net_salary
      return acc
    }, { headcount: 0, gross: 0, nssf: 0, shif: 0, ahl: 0, paye: 0, pension_ee: 0, pension_er: 0, deductions: 0, net: 0 })
  }, [employees])

  const ccBreakdown = useMemo(() => buildCostCentreBreakdown(summaries), [summaries])

  // Calculator result
  const calcResult = useMemo(() => {
    return computePayroll({
      base_salary: calcInputs.basic, bonus_commission: calcInputs.bonus,
      fringe_benefit: calcInputs.fbt, transport_allowance: calcInputs.transport,
      arrears: calcInputs.arrears, ot_other: calcInputs.ot,
      voluntary_pension: calcInputs.voluntary_pension,
      advances: calcInputs.advances, helb: calcInputs.helb,
      company_loan: calcInputs.company_loan, bank_loan: calcInputs.bank_loan,
      sacco: calcInputs.sacco,
    })
  }, [calcInputs])

  function toggleRow(idx: number) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  async function handleImportFile(file: File) {
    setImporting(true)
    setImportError(null)
    setImportPreview(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/payroll/import", { method: "POST", body: formData })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to parse the uploaded workbook")
      }
      setImportPreview(payload as ImportPreviewResult)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import workbook")
    } finally {
      setImporting(false)
    }
  }

  // Merge confirmed variable-pay values from the import preview into the
  // in-memory employee register (matched staff only — unmatched rows need
  // to go through the Master Data Hub first, since a payroll run can't
  // introduce a brand-new employee identity by itself).
  function applyImportPreview() {
    if (!importPreview) return
    setEmployees((prev) =>
      prev.map((emp) => {
        const match = importPreview.matched.find((m) => m.parsed.id === emp.id)
        if (!match) return emp
        const inputs = {
          base_salary: match.parsed.baseSalary,
          bonus_commission: match.parsed.bonusCommission,
          fringe_benefit: match.parsed.fringeBenefit,
          transport_allowance: match.parsed.transportAllowance,
          arrears: match.parsed.arrears,
          ot_other: match.parsed.otOther,
          voluntary_pension: emp.voluntary_pension,
          advances: emp.advances,
          helb: emp.helb,
          company_loan: emp.company_loan,
          bank_loan: emp.bank_loan,
          sacco: emp.sacco,
          personal_relief_override: emp.personal_relief_override ?? undefined,
          paye_band_flat_deduction: emp.paye_band_flat_deduction ?? undefined,
          pension_rate_override: emp.pension_rate_override ?? undefined,
          nssf_t2_override: emp.nssf_t2_override ?? undefined,
          ahl_relief_override: emp.ahl_relief_override ?? undefined,
        }
        const computed = computePayroll(inputs)
        return { ...emp, ...inputs, ...computed }
      })
    )
    addAuditLog(
      "PAYROLL VARIABLE-PAY IMPORTED",
      `${importPreview.matched.length} staff`,
      `Imported variable pay for ${importPreview.matched.length} matched staff (${importPreview.unmatched.length} unmatched, ${importPreview.skipped.length} rows skipped).`,
    )
    setImportPreview(null)
  }

  // Computes and saves this month's run (always lands as "Draft" — see
  // POST /api/payroll). This can be re-run freely to correct a Draft.
  async function computeAndSaveRun() {
    setWorkflowError(null)
    try {
      const response = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: apiMonth, employees }),
      })

      // Surface the server's actual reason — this used to throw away the
      // response body and log a generic "please verify the API is available",
      // which hid a real save failure behind a plausible-looking message.
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? `Payroll save failed (HTTP ${response.status}).`)
      }

      setRunStatus("Draft")
      addAuditLog(
        "PAYROLL COMPUTED",
        apiMonth,
        `Computed and saved a Draft payroll run for ${employees.length} staff. Gross: ${fmt(totals.gross)}, PAYE: ${fmt(totals.paye)}.`,
        totals.gross
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payroll save failed."
      setWorkflowError(message)
      addAuditLog("PAYROLL COMPUTE FAILED", apiMonth, message, totals.gross)
    }
  }

  async function runWorkflowAction(action: "submit" | "approve" | "reject") {
    setWorkflowBusy(true)
    setWorkflowError(null)
    try {
      const response = await fetch(`/api/payroll/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: apiMonth }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${action} the payroll run.`)
      }
      setRunStatus(payload.run.status)
      addAuditLog(
        `PAYROLL ${action.toUpperCase()}D`,
        apiMonth,
        `Payroll run for ${apiMonth} moved to status "${payload.run.status}".`,
        totals.gross
      )
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : `Failed to ${action} the payroll run.`)
    } finally {
      setWorkflowBusy(false)
    }
  }

  function handleExportRegister() {
    // Full Employee rows, not the slim summaries — the register export fills
    // every column (basic, bonus, taxable pay, reliefs, ...), mirroring
    // Tony's Excel register with no blank placeholders.
    const csv = buildMasterRegisterCSV(employees)
    downloadCSV(csv, `chrysal-payroll-register-${payMonth.replace(" ", "-")}.csv`)
  }

  // Downloads the real balanced Dr/Cr journal (lib/journal-builder.ts) — the
  // same one "Post to AX" builds — rather than the older flat summary, so
  // there's an actual file ready to hand an AX admin for manual import while
  // we wait on live API access. Read-only: doesn't call the AX client or
  // change the run's status, unlike handlePostToAx below.
  async function handleExportGL() {
    if (busyAction) return
    setBusyAction("gl")
    setWorkflowError(null)
    try {
      const response = await fetch(`/api/payroll/gl-journal?month=${apiMonth}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? "Failed to generate the AX GL journal.")
      }
      triggerDownload(await response.blob(), `chrysal-ax-gl-journal-${apiMonth}.csv`)
      addAuditLog(
        "AX GL JOURNAL DOWNLOADED",
        apiMonth,
        `Downloaded the balanced Dr/Cr GL journal CSV for the ${apiMonth} payroll run.`,
      )
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : "Failed to generate the AX GL journal.")
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePostToAx() {
    setPostingToAx(true)
    setAxError(null)
    try {
      const response = await fetch("/api/payroll/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: apiMonth }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to build/post the AX journal.")
      }

      setAxJournal(payload.journal)
      setAxResult(payload.axResult)
      addAuditLog(
        "AX JOURNAL POSTED",
        payload.axResult?.journalNumber ?? apiMonth,
        payload.axResult?.isMock
          ? `Payroll journal for ${apiMonth} built and posted to a MOCKED Dynamics AX response (${payload.axResult.message})`
          : `Payroll journal for ${apiMonth} posted to Dynamics AX. Journal: ${payload.axResult?.journalNumber}`,
        payload.journal?.totalDebit,
      )
    } catch (err) {
      setAxError(err instanceof Error ? err.message : "Unknown error posting to AX.")
    } finally {
      setPostingToAx(false)
    }
  }

  // One-click generation — payslips (PDF), bank batch file, and iTax export.
  // All three are gated server-side to Approved/Posted runs and downloaded
  // as file attachments; this just triggers the browser download and logs it.
  async function handleGenerate(kind: "payslips" | "bank-batch" | "itax-export") {
    const routeByKind = {
      payslips: { path: "/api/payroll/payslips", ext: "pdf", label: "Payslips" },
      "bank-batch": { path: "/api/payroll/bank-batch", ext: "csv", label: "Bank Batch File" },
      "itax-export": { path: "/api/payroll/itax-export", ext: "csv", label: "iTax Export" },
    }[kind]
    if (busyAction) return
    setBusyAction(kind)
    setWorkflowError(null)
    try {
      const response = await fetch(`${routeByKind.path}?month=${apiMonth}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? `Failed to generate ${routeByKind.label}.`)
      }
      triggerDownload(await response.blob(), `chrysal-${kind}-${apiMonth}.${routeByKind.ext}`)
      addAuditLog(
        `PAYROLL ${routeByKind.label.toUpperCase()} GENERATED`,
        apiMonth,
        `Generated ${routeByKind.label} for the ${apiMonth} payroll run (${employees.length} staff).`,
      )
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : `Failed to generate ${routeByKind.label}.`)
    } finally {
      setBusyAction(null)
    }
  }

  // Annual P9 tax deduction cards, built from every Approved/Posted run in
  // the selected period's year. Two shapes: "combined" is one PDF with every
  // employee's page, for Tony's own filing/archive copy — never hand this to
  // an individual employee, since it exposes everyone else's pay too. "zip"
  // packages the same data as separate single-employee PDFs, one file each,
  // the correct shape for distributing per person.
  async function handleGenerateP9(format: "combined" | "zip") {
    if (busyAction) return
    const year = apiMonth.slice(0, 4)
    setBusyAction(`p9-${format}`)
    setWorkflowError(null)
    try {
      const response = await fetch(`/api/payroll/p9?year=${year}&format=${format}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? "Failed to generate P9 forms.")
      }
      const ext = format === "zip" ? "zip" : "pdf"
      triggerDownload(await response.blob(), `chrysal-p9-forms-${year}-${format}.${ext}`)
      addAuditLog(
        "PAYROLL P9 FORMS GENERATED",
        year,
        `Generated ${format === "zip" ? "individual (zipped)" : "combined"} P9 tax deduction cards for ${year}.`,
      )
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : "Failed to generate P9 forms.")
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSendP9() {
    if (busyAction) return
    const year = apiMonth.slice(0, 4)
    setBusyAction("send-p9")
    setWorkflowError(null)
    try {
      const response = await fetch("/api/payroll/send-p9", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to email P9 forms.")
      }
      addAuditLog(
        "PAYROLL P9 FORMS EMAILED",
        year,
        `Emailed ${payload.sent.length} P9 card(s) for ${year} (${payload.skippedNoEmail.length} skipped, no email on file).`,
      )
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : "Failed to email P9 forms.")
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSendPayslips() {
    setSendingPayslips(true)
    setSendPayslipsResult(null)
    setWorkflowError(null)
    try {
      const response = await fetch("/api/payroll/send-payslips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: apiMonth }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to send payslips.")
      }
      setSendPayslipsResult(payload)
      addAuditLog(
        "PAYROLL PAYSLIPS EMAILED",
        apiMonth,
        `Emailed ${payload.sent.length} payslip(s) for the ${apiMonth} payroll run (${payload.skippedNoEmail.length} skipped, no email on file).`,
      )
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : "Failed to send payslips.")
    } finally {
      setSendingPayslips(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "register", label: "Payroll Register", icon: <Wallet className="h-3.5 w-3.5" /> },
    { id: "statutory", label: "Statutory Summary", icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { id: "gl", label: "AX GL Posting", icon: <Building2 className="h-3.5 w-3.5" /> },
    { id: "calculator", label: "PAYE Calculator", icon: <Calculator className="h-3.5 w-3.5" /> },
  ]

  // Payroll contains salary/PII data — restricted to finance_manager. The
  // real enforcement is server-side (every /api/payroll* route checks this
  // too, since they use the admin client and bypass RLS); this is just so
  // the UI doesn't render sensitive data before those requests 403.
  if (!authLoading && currentUserRole !== "finance_manager") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
        <Lock className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
        <h1 className="text-sm font-bold font-mono uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Access Restricted</h1>
        <p className="text-zinc-400 text-xs max-w-sm">
          Payroll contains salary and personal data restricted to the Finance Manager role. Contact your
          administrator if you believe you should have access.
        </p>
      </div>
    )
  }

  return (
    <ModuleLock moduleName="Payroll & PAYE">
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-3 border-b border-zinc-200 dark:border-zinc-900 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="space-y-0.5">
            <h1 className="text-base font-bold font-mono uppercase tracking-wider">Payroll &amp; Statutory Compliance</h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-xs max-w-2xl">
              Automate monthly payroll using KRA PAYE graduated slabs, NSSF Tier I/II, SHIF (2.75%), and AHL (1.5%). Generate downloadable AX GL posting summary matching Chrysal&apos;s ERP format.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="pay-period-month" className="text-[9px] font-mono uppercase tracking-wider text-zinc-400">
              Pay Period
            </label>
            {/* Explicit month + year dropdowns rather than a native month
                input — the native control's year navigation is easy to miss,
                and past-period corrections need the year to be unmistakable. */}
            <select
              id="pay-period-month"
              value={apiMonth.slice(5, 7)}
              onChange={(e) => setApiMonth(`${apiMonth.slice(0, 4)}-${e.target.value}`)}
              className={`bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
            >
              {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((label, i) => (
                <option key={label} value={String(i + 1).padStart(2, "0")}>{label}</option>
              ))}
            </select>
            <select
              aria-label="Pay period year"
              value={apiMonth.slice(0, 4)}
              onChange={(e) => setApiMonth(`${e.target.value}-${apiMonth.slice(5, 7)}`)}
              className={`bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
            >
              {/* 2024 (earliest data in the pilot) through next year, so a
                  December run can be prepared/corrected into January. */}
              {Array.from({ length: new Date().getFullYear() + 1 - 2024 + 1 }, (_, i) => String(2024 + i)).map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            {apiMonth !== currentMonth && (
              <span className="text-[9px] font-mono uppercase tracking-wider text-amber-500">
                Not the current month — filing against {payMonth}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {/* Rejected shows Run Payroll too — re-running resets the run to
              Draft (the recovery path the "RE-RUN AND RESUBMIT" banner asks
              for; previously the banner asked but no button was offered). */}
          {(runStatus === null || runStatus === "Draft" || runStatus === "Rejected") && (
            <button
              onClick={computeAndSaveRun}
              disabled={validationErrors.length > 0 || loadingEmployees}
              title={validationErrors.length > 0 ? "Fix the blocking issues listed below first" : undefined}
              className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed ${buttonRadius}`}
            >
              <Calculator className="h-3.5 w-3.5" /><span>Run Payroll</span>
            </button>
          )}
          {(runStatus === null || runStatus === "Draft") && (
            <button
              onClick={() => runWorkflowAction("submit")}
              disabled={workflowBusy}
              className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50 ${accentBg} ${buttonRadius}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Submit for Approval</span>
            </button>
          )}
          {runStatus === "Submitted" && (
            currentUserRole === "finance_manager" ? (
              <>
                <button
                  onClick={() => runWorkflowAction("approve")}
                  disabled={workflowBusy}
                  className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50 ${accentBg} ${buttonRadius}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /><span>Approve</span>
                </button>
                <button
                  onClick={() => runWorkflowAction("reject")}
                  disabled={workflowBusy}
                  className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30 disabled:opacity-50 rounded"
                >
                  <X className="h-3.5 w-3.5" /><span>Reject</span>
                </button>
              </>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-mono text-[10px] border border-amber-200 bg-amber-50/20 px-2 py-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>PENDING FINANCE MANAGER APPROVAL</span>
              </span>
            )
          )}
          {runStatus === "Rejected" && (
            <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-mono text-[10px] border border-rose-200 bg-rose-50/20 px-2 py-1">
              <X className="h-3.5 w-3.5" />
              <span>REJECTED — RE-RUN AND RESUBMIT</span>
            </span>
          )}
          {runStatus === "Approved" && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] border border-emerald-200 bg-emerald-50/20 px-2 py-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>APPROVED — READY TO POST</span>
            </span>
          )}
          {runStatus === "Posted" && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] border border-emerald-200 bg-emerald-50/20 px-2 py-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>POSTED TO LEDGER</span>
            </span>
          )}
          <button
            onClick={handleExportRegister}
            disabled={busyAction !== null || employees.length === 0}
            className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed ${buttonRadius}`}
          >
            <Download className="h-3.5 w-3.5" /><span>Export Register</span>
          </button>
          <button
            onClick={handleExportGL}
            disabled={busyAction !== null}
            className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed ${buttonRadius}`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>{busyAction === "gl" ? "Preparing…" : "Export AX GL"}</span>
          </button>
        </div>
      </div>

      {workflowError && (
        <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">
          {workflowError}
        </div>
      )}

      {/* Pre-flight validation results */}
      {validationErrors.length > 0 && (
        <div className="p-3 border border-rose-200 bg-rose-50/40 dark:bg-rose-950/20 dark:border-rose-900 text-[11px] space-y-1">
          <p className="font-bold font-mono uppercase text-[10px] tracking-wider text-rose-600 dark:text-rose-400">
            {validationErrors.length} blocking issue{validationErrors.length > 1 ? "s" : ""} — Run Payroll is disabled until these are fixed in Employee Master
          </p>
          {validationErrors.slice(0, 8).map((issue, i) => (
            <p key={i} className="text-rose-700 dark:text-rose-400">
              <span className="font-mono font-bold">{issue.employeeId}</span> ({issue.name}): {issue.message}
            </p>
          ))}
          {validationErrors.length > 8 && (
            <p className="text-rose-500">…and {validationErrors.length - 8} more.</p>
          )}
        </div>
      )}
      {validationWarnings.length > 0 && (
        <div className="p-3 border border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-900 text-[11px] space-y-1">
          <p className="font-bold font-mono uppercase text-[10px] tracking-wider text-amber-600 dark:text-amber-400">
            {validationWarnings.length} warning{validationWarnings.length > 1 ? "s" : ""} — the run can proceed, but some outputs will skip these employees
          </p>
          {validationWarnings.slice(0, 5).map((issue, i) => (
            <p key={i} className="text-amber-700 dark:text-amber-400">
              <span className="font-mono font-bold">{issue.employeeId}</span> ({issue.name}): {issue.message}
            </p>
          ))}
          {validationWarnings.length > 5 && (
            <p className="text-amber-500">…and {validationWarnings.length - 5} more. Fix these in Employee Master.</p>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Headcount", value: totals.headcount.toString(), sub: "Active Staff", color: "" },
          { label: "Total Gross", value: `KES ${fmt(totals.gross)}`, sub: "This Month", color: "" },
          { label: "Net PAYE", value: `KES ${fmt(totals.paye)}`, sub: "KRA Liability", color: "text-rose-600" },
          { label: "NSSF (EE)", value: `KES ${fmt(totals.nssf)}`, sub: "T1 + T2", color: "" },
          { label: "SHIF", value: `KES ${fmt(totals.shif)}`, sub: "2.75%", color: "" },
          { label: "Net Disbursed", value: `KES ${fmt(totals.net)}`, sub: "Cash to Staff", color: "text-emerald-600" },
        ].map(card => (
          <div key={card.label} className={`p-4 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 flex flex-col justify-between h-20 ${cardRadius}`}>
            <span className="text-[9px] font-mono uppercase text-zinc-400">{card.label}</span>
            <span className={`text-sm font-bold font-mono ${card.color || "text-zinc-800 dark:text-zinc-100"}`}>{card.value}</span>
            <span className="text-[8px] text-zinc-400 font-mono">{card.sub}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-200 dark:border-zinc-900 flex gap-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 font-mono text-[10px] uppercase tracking-wider border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-zinc-800 dark:border-zinc-200 text-zinc-800 dark:text-zinc-200"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Tab: Payroll Register ──────────────────────────────────────────────── */}
      {activeTab === "register" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-zinc-400" />
              <span className="text-xs font-mono uppercase tracking-wider font-bold">Employee Payroll Register — {payMonth}</span>
            </div>
            <div className="flex gap-2">
              <label
                className={`px-2.5 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer ${buttonRadius} ${importing ? "opacity-50 pointer-events-none" : ""}`}
              >
                <Upload className="h-3.5 w-3.5" /><span>{importing ? "Parsing…" : "Import Variable Pay"}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImportFile(file)
                    e.target.value = ""
                  }}
                />
              </label>
              <Link
                href="/employees"
                className={`px-2.5 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
              >
                <IdCard className="h-3.5 w-3.5" /><span>Manage Employees</span>
              </Link>
            </div>
          </div>

          {loadingEmployees && (
            <div className="text-[10px] font-mono uppercase text-zinc-400">Loading payroll data from Supabase…</div>
          )}

          {importError && (
            <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">
              {importError}
            </div>
          )}

          {importPreview && (
            <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-3 ${cardRadius}`}>
              <div className="flex items-center justify-between border-b dark:border-zinc-900 pb-2">
                <h3 className="text-xs font-mono uppercase tracking-wider font-bold">Import Preview</h3>
                <button onClick={() => setImportPreview(null)} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-3 gap-3 font-mono text-[10px]">
                <div className="text-emerald-600">{importPreview.matched.length} matched</div>
                <div className="text-amber-500">{importPreview.unmatched.length} unmatched (not in Employee Master)</div>
                <div className="text-zinc-400">{importPreview.skipped.length} rows skipped</div>
              </div>
              {importPreview.unmatched.length > 0 && (
                <p className="text-[9px] font-mono text-amber-500">
                  Unmatched staff numbers won&apos;t be applied — add them via Manage Employees first, then re-import.
                </p>
              )}
              <div className="max-h-40 overflow-y-auto border-t dark:border-zinc-900 pt-2 text-[10px] font-mono space-y-1">
                {importPreview.matched.map((m) => (
                  <div key={m.parsed.id} className="flex justify-between text-zinc-500">
                    <span>{m.parsed.id} · {m.existingName}</span>
                    <span>Basic {fmt(m.parsed.baseSalary)}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={applyImportPreview}
                disabled={importPreview.matched.length === 0}
                className={`w-full py-2 font-mono text-[10px] uppercase tracking-wider font-bold disabled:opacity-50 ${accentBg} ${buttonRadius}`}
              >
                Apply {importPreview.matched.length} Matched Rows to Register
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Register table */}
            <div className={`lg:col-span-2 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 overflow-hidden ${cardRadius}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-900 text-zinc-400 font-mono text-[9px] uppercase tracking-wider">
                      <th className="px-4 py-2.5"></th>
                      <th className="px-4 py-2.5">Staff</th>
                      <th className="px-4 py-2.5 text-right">Basic</th>
                      <th className="px-4 py-2.5 text-right">Gross</th>
                      <th className="px-4 py-2.5 text-right">Net PAYE</th>
                      <th className="px-4 py-2.5 text-right">Total Ded.</th>
                      <th className="px-4 py-2.5 text-right">Net Pay</th>
                      <th className="px-4 py-2.5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900 text-[11px]">
                    {employees.map((emp, idx) => {
                      const expanded = expandedRows.has(idx)
                      return (
                        <React.Fragment key={emp.id}>
                          <tr className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20">
                            <td className="px-2 py-3">
                              <button onClick={() => toggleRow(idx)} className="text-zinc-400 hover:text-zinc-600">
                                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-zinc-800 dark:text-zinc-200">{emp.name}</p>
                              <span className="text-[9px] text-zinc-400 font-mono">
                                {emp.id} · CC {emp.cost_centre ?? "—"} · {emp.grade}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono">{fmt(emp.base_salary)}</td>
                            <td className="px-4 py-3 text-right font-mono">{fmt(emp.gross_salary ?? 0)}</td>
                            <td className="px-4 py-3 text-right font-mono text-rose-500">–{fmt(emp.net_paye ?? emp.paye)}</td>
                            <td className="px-4 py-3 text-right font-mono text-rose-400">–{fmt(emp.deductions)}</td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">{fmt(emp.net_salary)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => setActiveEmpIdx(idx)}
                                  className={`p-1 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
                                  title="View payslip"
                                >
                                  <Eye className="h-3.5 w-3.5 text-zinc-400" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="bg-zinc-50/30 dark:bg-zinc-900/10">
                              <td colSpan={8} className="px-6 py-3">
                                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-[10px] font-mono">
                                  {[
                                    ["NSSF T1", `420`],
                                    ["NSSF T2", `1,740`],
                                    ["SHIF 2.75%", fmt(emp.shif ?? emp.nhif)],
                                    ["AHL 1.5%", fmt(emp.ahl ?? 0)],
                                    ["Pension EE 5%", fmt(emp.defined_pension_ee ?? 0)],
                                    ["Pension ER 10%", fmt(emp.defined_pension_er ?? 0)],
                                    ["Taxable Pay", fmt(emp.taxable_pay ?? 0)],
                                    ["Gross PAYE", fmt(emp.gross_paye ?? 0)],
                                    ["Personal Relief", "2,400"],
                                    ["AHL Relief", fmt(emp.ahl_relief ?? 0)],
                                    ["Net PAYE", fmt(emp.net_paye ?? emp.paye)],
                                    ["Advances", fmt(emp.advances ?? 0)],
                                    ["HELB", fmt(emp.helb ?? 0)],
                                    ["Company Loan", fmt(emp.company_loan ?? 0)],
                                    ["Bank Loan", fmt(emp.bank_loan ?? 0)],
                                    ["SACCO", fmt(emp.sacco ?? 0)],
                                  ].map(([l, v]) => (
                                    <div key={l}>
                                      <p className="text-[8px] uppercase text-zinc-400">{l}</p>
                                      <p className="text-zinc-700 dark:text-zinc-300">{v}</p>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-zinc-50 dark:bg-zinc-900/60 border-t border-zinc-200 dark:border-zinc-900 font-bold font-mono text-[10px]">
                      <td></td>
                      <td className="px-4 py-2.5 text-zinc-500 uppercase">Totals</td>
                      <td className="px-4 py-2.5 text-right">{fmt(employees.reduce((s,e) => s + e.base_salary, 0))}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(totals.gross)}</td>
                      <td className="px-4 py-2.5 text-right text-rose-500">–{fmt(totals.paye)}</td>
                      <td className="px-4 py-2.5 text-right text-rose-400">–{fmt(totals.deductions)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{fmt(totals.net)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Payslip panel */}
            <div className={`border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-5 ${cardRadius}`}>
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold border-b border-zinc-150 dark:border-zinc-900 pb-2 mb-4">Payslip Terminal</h3>
              {activeEmpIdx === null ? (
                <div className="py-16 text-center text-zinc-400 font-mono text-[10px] uppercase">
                  Click the <Eye className="inline h-3 w-3" /> icon on a row to view the payslip.
                </div>
              ) : (
                <PayslipPanel
                  emp={employees[activeEmpIdx]}
                  onClose={() => setActiveEmpIdx(null)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Statutory Summary ─────────────────────────────────────────────── */}
      {activeTab === "statutory" && (
        <div className="space-y-6">
          {/* PAYE slab reference */}
          <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 ${cardRadius}`}>
            <div className="flex items-center gap-2 mb-4 border-b dark:border-zinc-900 pb-2">
              <TrendingUp className="h-4 w-4 text-zinc-400" />
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold">KRA PAYE Graduated Slabs (Monthly)</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {BANDS.map(band => (
                <div key={band.rate} className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-900 p-3 rounded text-center">
                  <div className="text-base font-bold font-mono text-zinc-800 dark:text-zinc-200">{band.rate}</div>
                  <div className="text-[9px] text-zinc-500 font-mono mt-0.5">{band.range}</div>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-zinc-400 font-mono mt-3">
              Personal Relief: KES 2,400/mo · AHL Relief applied at marginal rate · Source: KRA 2024 Tax Bands
            </p>
          </div>

          {/* Per-employee statutory detail */}
          <div className={`border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 overflow-hidden ${cardRadius}`}>
            <div className="px-5 py-3 border-b dark:border-zinc-900">
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold">Statutory Deductions Breakdown — All Staff</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/60 text-zinc-400 font-mono text-[9px] uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-900">
                    <th className="px-4 py-2.5">Staff</th>
                    <th className="px-4 py-2.5 text-right">Gross</th>
                    <th className="px-4 py-2.5 text-right">NSSF T1</th>
                    <th className="px-4 py-2.5 text-right">NSSF T2</th>
                    <th className="px-4 py-2.5 text-right">SHIF 2.75%</th>
                    <th className="px-4 py-2.5 text-right">AHL 1.5%</th>
                    <th className="px-4 py-2.5 text-right">Pen. EE 5%</th>
                    <th className="px-4 py-2.5 text-right">Pen. ER 10%</th>
                    <th className="px-4 py-2.5 text-right">Net PAYE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900 text-[11px]">
                  {employees.map(emp => (
                    <tr key={emp.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 font-mono">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-zinc-800 dark:text-zinc-200">{emp.name}</p>
                        <span className="text-[9px] text-zinc-400">{emp.id} · CC {emp.cost_centre ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">{fmt(emp.gross_salary ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(emp.nssf_t1 ?? 420)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(emp.nssf_t2 ?? 1740)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(emp.shif ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(emp.ahl ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(emp.defined_pension_ee ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">{fmt(emp.defined_pension_er ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right text-rose-500 font-bold">{fmt(emp.net_paye ?? emp.paye)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/60 border-t border-zinc-200 dark:border-zinc-900 font-bold font-mono text-[10px]">
                    <td className="px-4 py-2.5 text-zinc-500 uppercase">Totals</td>
                    <td className="px-4 py-2.5 text-right">{fmt(totals.gross)}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(employees.length * 420)}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(employees.length * 1740)}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(totals.shif)}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(totals.ahl)}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(totals.pension_ee)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-500">{fmt(totals.pension_er)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-500">{fmt(totals.paye)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: AX GL Posting ────────────────────────────────────────────────── */}
      {activeTab === "gl" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* GL Posting Summary — matching rows 174-183 format */}
            <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-4 ${cardRadius}`}>
              <div className="flex items-center justify-between border-b dark:border-zinc-900 pb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-zinc-400" />
                  <h3 className="text-xs font-mono uppercase tracking-wider font-bold">AX GL Posting Summary</h3>
                </div>
                <span className={`text-[9px] font-mono px-2 py-0.5 ${accentBadge}`}>{payMonth}</span>
              </div>

              {/* Rendered from the same buildPayrollJournal() the Post-to-AX
                  action and the CSV download use, so what's on screen is the
                  real balanced journal. The previous version of this panel
                  hardcoded its own Dr/Cr rows and printed one total in BOTH
                  columns, so it always looked balanced while the credit lines
                  actually fell ~2.03M short and reused account 11500 twice. */}
              <div className="font-mono text-[11px] space-y-0">
                <div className="flex justify-between text-[9px] uppercase text-zinc-400 border-b dark:border-zinc-800 pb-1.5 mb-1.5">
                  <span>Account</span>
                  <span className="grid grid-cols-2 gap-8 text-right w-48"><span>DR</span><span>CR</span></span>
                </div>

                {previewJournal.lines.map((line) => (
                  <div key={line.lineNumber} className={`flex justify-between py-1 gap-3 ${line.debit > 0 ? "" : "text-zinc-500"}`}>
                    <span className="min-w-0">
                      <span className="block truncate">
                        {line.debit > 0 ? "Dr" : "Cr"}: {line.accountName} ({line.accountCode})
                      </span>
                      <span className="block text-[9px] text-zinc-400">
                        {line.dimension.department}/{line.dimension.costCentre}
                      </span>
                    </span>
                    <span className="grid grid-cols-2 gap-8 text-right w-48 shrink-0">
                      <span>{line.debit > 0 ? fmtD(line.debit) : <span className="text-zinc-400">—</span>}</span>
                      <span>{line.credit > 0 ? fmtD(line.credit) : <span className="text-zinc-400">—</span>}</span>
                    </span>
                  </div>
                ))}

                <div className="border-t-2 dark:border-zinc-700 pt-2 mt-2 flex justify-between font-bold">
                  <span className={previewJournal.isBalanced ? "text-emerald-600" : "text-rose-500"}>
                    Total {previewJournal.isBalanced ? "(Balanced ✓)" : "(NOT BALANCED ✗)"}
                  </span>
                  <span className="grid grid-cols-2 gap-8 text-right w-48 shrink-0">
                    <span>{fmtD(previewJournal.totalDebit)}</span>
                    <span>{fmtD(previewJournal.totalCredit)}</span>
                  </span>
                </div>
              </div>

              <button
                onClick={handleExportGL}
                disabled={busyAction !== null}
                className={`w-full mt-2 py-2 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-mono text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${buttonRadius}`}
              >
                <Download className="h-3.5 w-3.5" />
                <span>{busyAction === "gl" ? "Preparing file…" : "Download AX GL CSV"}</span>
              </button>

              {/* The shared error banner sits at the top of the page, far
                  off-screen from here — repeat it next to the button that
                  triggered it so a failed download isn't silent. */}
              {workflowError && (
                <p className="text-[10px] font-mono text-rose-500 leading-relaxed">{workflowError}</p>
              )}
            </div>

            {/* Cost Centre breakdown */}
            <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-4 ${cardRadius}`}>
              <div className="flex items-center gap-2 border-b dark:border-zinc-900 pb-2">
                <DollarSign className="h-4 w-4 text-zinc-400" />
                <h3 className="text-xs font-mono uppercase tracking-wider font-bold">Cost Centre Distribution</h3>
              </div>

              <div className="space-y-3">
                {ccBreakdown.map(cc => (
                  <div key={cc.code} className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-900 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 ${accentBadge} mr-2`}>{cc.code}</span>
                        <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">{cc.name}</span>
                      </div>
                      <span className="text-[9px] font-mono text-zinc-400">{cc.headcount} staff</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                      <div>
                        <p className="text-[8px] uppercase text-zinc-400">Gross</p>
                        <p>{fmt(cc.gross)}</p>
                      </div>
                      <div>
                        <p className="text-[8px] uppercase text-zinc-400">PAYE</p>
                        <p className="text-rose-500">{fmt(cc.paye)}</p>
                      </div>
                      <div>
                        <p className="text-[8px] uppercase text-zinc-400">Net</p>
                        <p className="text-emerald-600">{fmt(cc.net)}</p>
                      </div>
                      <div>
                        <p className="text-[8px] uppercase text-zinc-400">Pension ER</p>
                        <p className="text-zinc-500">{fmt(cc.pension_er)}</p>
                      </div>
                      <div>
                        <p className="text-[8px] uppercase text-zinc-400">NSSF</p>
                        <p>{fmt(cc.nssf)}</p>
                      </div>
                      <div>
                        <p className="text-[8px] uppercase text-zinc-400">AHL</p>
                        <p>{fmt(cc.ahl)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AX Journal Preview & Post */}
          <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-4 ${cardRadius}`}>
            <div className="flex items-center justify-between border-b dark:border-zinc-900 pb-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-zinc-400" />
                <h3 className="text-xs font-mono uppercase tracking-wider font-bold">Dynamics AX Journal (Preview / Post)</h3>
              </div>
              <button
                onClick={handlePostToAx}
                disabled={runStatus !== "Approved" || postingToAx}
                title={runStatus !== "Approved" ? "The run must be Submitted and Approved by the finance manager first" : undefined}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${accentBg} ${buttonRadius}`}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{postingToAx ? "Building & Posting…" : "Post to AX (Dynamics)"}</span>
              </button>
            </div>

            {runStatus !== "Approved" && (
              <p className="text-[10px] font-mono text-zinc-400">
                Run Payroll, Submit for Approval, and have the finance manager Approve it above first — the journal
                is built from this month&apos;s saved payroll register entries.
              </p>
            )}

            {axError && (
              <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">
                {axError}
              </div>
            )}

            {axResult && (
              <div className={`p-3 border text-[11px] flex items-center gap-2 ${
                axResult.success
                  ? "border-emerald-200 bg-emerald-50/40 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900"
                  : "border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900"
              }`}>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <div>
                  <p className="font-bold font-mono">
                    {axResult.isMock ? "MOCKED — " : ""}Journal {axResult.journalNumber}
                  </p>
                  <p>{axResult.message}</p>
                </div>
              </div>
            )}

            {axJournal && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[10px] font-mono">
                  <thead>
                    <tr className="border-b border-zinc-150 dark:border-zinc-900 text-zinc-400 uppercase tracking-wider">
                      <th className="py-1.5 pr-2">#</th>
                      <th className="py-1.5 pr-2">Account</th>
                      <th className="py-1.5 pr-2">Dimension (Dept/CC)</th>
                      <th className="py-1.5 pr-2 text-right">Debit</th>
                      <th className="py-1.5 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                    {axJournal.lines.map((line) => (
                      <tr key={line.lineNumber}>
                        <td className="py-1.5 pr-2 text-zinc-400">{line.lineNumber}</td>
                        <td className="py-1.5 pr-2">
                          <span className="font-semibold">{line.accountCode}</span>
                          <span className="block text-zinc-400 text-[9px]">{line.accountName}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-zinc-500">{line.dimension.department}/{line.dimension.costCentre}</td>
                        <td className="py-1.5 pr-2 text-right">{line.debit > 0 ? fmtD(line.debit) : "—"}</td>
                        <td className="py-1.5 text-right">{line.credit > 0 ? fmtD(line.credit) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 dark:border-zinc-700 font-bold">
                      <td colSpan={3} className="py-2">Total {axJournal.isBalanced ? "(Balanced ✓)" : "(NOT BALANCED ✗)"}</td>
                      <td className="py-2 text-right">{fmtD(axJournal.totalDebit)}</td>
                      <td className="py-2 text-right">{fmtD(axJournal.totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* One-Click Generation */}
          <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-3 ${cardRadius}`}>
            <div className="flex items-center gap-2 border-b dark:border-zinc-900 pb-2">
              <FileSpreadsheet className="h-4 w-4 text-zinc-400" />
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold">One-Click Generation</h3>
            </div>
            <p className="text-[9px] font-mono text-amber-500">
              Bank batch file and iTax export use placeholder formats pending the real bank template and KRA iTax
              template — see the file header comments in lib/bank-batch-builder.ts and lib/itax-export-builder.ts.
            </p>
            <div className="flex flex-wrap gap-2">
              {([
                ["payslips", "Generate Payslips (PDF)"],
                ["bank-batch", "Generate Bank Batch File"],
                ["itax-export", "Generate iTax Export"],
              ] as const).map(([kind, label]) => (
                <button
                  key={kind}
                  onClick={() => handleGenerate(kind)}
                  disabled={(runStatus !== "Approved" && runStatus !== "Posted") || busyAction !== null}
                  title={runStatus !== "Approved" && runStatus !== "Posted" ? "The run must be Approved first" : undefined}
                  className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{busyAction === kind ? "Preparing file…" : label}</span>
                </button>
              ))}
              <button
                onClick={() => handleGenerateP9("zip")}
                disabled={busyAction !== null}
                title={`Individual P9 PDFs for ${apiMonth.slice(0, 4)}, one file per employee in a ZIP — needs at least one Approved run in the year`}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
              >
                <Download className="h-3.5 w-3.5" />
                <span>{busyAction === "p9-zip" ? "Preparing file…" : `Download Individual P9s (${apiMonth.slice(0, 4)})`}</span>
              </button>
              <button
                onClick={() => handleGenerateP9("combined")}
                disabled={busyAction !== null}
                title={`One combined PDF with every employee's P9 for ${apiMonth.slice(0, 4)} — for your own filing/archive copy, not for distributing to staff`}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
              >
                <Download className="h-3.5 w-3.5" />
                <span>{busyAction === "p9-combined" ? "Preparing file…" : "Combined P9 Archive Copy"}</span>
              </button>
              <button
                onClick={handleSendP9}
                disabled={busyAction !== null}
                title={`Emails each employee their own individual P9 for ${apiMonth.slice(0, 4)}`}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
              >
                <Mail className="h-3.5 w-3.5" />
                <span>{busyAction === "send-p9" ? "Sending…" : "Email P9 Forms to Employees"}</span>
              </button>
              <button
                onClick={handleSendPayslips}
                disabled={(runStatus !== "Approved" && runStatus !== "Posted") || sendingPayslips}
                title={runStatus !== "Approved" && runStatus !== "Posted" ? "The run must be Approved first" : undefined}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
              >
                <Mail className="h-3.5 w-3.5" /><span>{sendingPayslips ? "Sending…" : "Email Payslips to Employees"}</span>
              </button>
            </div>
            {sendPayslipsResult && (
              <p className="text-[9px] font-mono text-zinc-500">
                Sent {sendPayslipsResult.sent.length}
                {sendPayslipsResult.skippedNoEmail.length > 0 && `, skipped ${sendPayslipsResult.skippedNoEmail.length} (no email on file: ${sendPayslipsResult.skippedNoEmail.join(", ")})`}
                {sendPayslipsResult.failed.length > 0 && `, failed ${sendPayslipsResult.failed.length}`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: PAYE Calculator ──────────────────────────────────────────────── */}
      {activeTab === "calculator" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Inputs */}
          <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-4 ${cardRadius}`}>
            <div className="flex items-center justify-between border-b dark:border-zinc-900 pb-2">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-zinc-400" />
                <h3 className="text-xs font-mono uppercase tracking-wider font-bold">Standalone PAYE Calculator</h3>
              </div>
              <button
                onClick={() => setCalcInputs({ basic:0, bonus:0, fbt:0, transport:0, arrears:0, ot:0, voluntary_pension:0, advances:0, helb:0, company_loan:0, bank_loan:0, sacco:0 })}
                className="text-zinc-400 hover:text-zinc-600 flex items-center gap-0.5 text-[9px] font-mono"
              >
                <RotateCcw className="h-3 w-3" />Reset
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-[9px] font-mono uppercase text-zinc-400">Earnings (KES/month)</p>
              {[
                { label: "Basic Salary", key: "basic" },
                { label: "Bonus / Commission", key: "bonus" },
                { label: "Fringe Benefit (FBT)", key: "fbt" },
                { label: "Transport Allowance", key: "transport" },
                { label: "Arrears", key: "arrears" },
                { label: "OT / Other Earnings", key: "ot" },
              ].map(({ label, key }) => (
                <div key={key} className="flex items-center gap-3">
                  <label className="text-[10px] font-mono text-zinc-500 w-40 shrink-0">{label}</label>
                  <input
                    type="number"
                    value={(calcInputs as Record<string, number>)[key] || ""}
                    onChange={e => setCalcInputs(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                    placeholder="0"
                    className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded"
                  />
                </div>
              ))}
              <p className="text-[9px] font-mono uppercase text-zinc-400 pt-2">Deductions (Post-Tax)</p>
              {[
                { label: "Voluntary Pension", key: "voluntary_pension" },
                { label: "Advances", key: "advances" },
                { label: "HELB", key: "helb" },
                { label: "Company Loan", key: "company_loan" },
                { label: "Bank Loan", key: "bank_loan" },
                { label: "SACCO", key: "sacco" },
              ].map(({ label, key }) => (
                <div key={key} className="flex items-center gap-3">
                  <label className="text-[10px] font-mono text-zinc-500 w-40 shrink-0">{label}</label>
                  <input
                    type="number"
                    value={(calcInputs as Record<string, number>)[key] || ""}
                    onChange={e => setCalcInputs(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                    placeholder="0"
                    className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Results */}
          <div className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-4 ${cardRadius}`}>
            <h3 className="text-xs font-mono uppercase tracking-wider font-bold border-b dark:border-zinc-900 pb-2">Computed Result</h3>

            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex justify-between border-b dark:border-zinc-900 pb-2 font-bold">
                <span>Gross Salary</span><span>{fmt(calcResult.gross_salary)}</span>
              </div>
              {[
                { label: "NSSF Tier I", val: calcResult.nssf_t1, color: "text-rose-400" },
                { label: "NSSF Tier II", val: calcResult.nssf_t2, color: "text-rose-400" },
                { label: "SHIF (2.75%)", val: calcResult.shif, color: "text-rose-400" },
                { label: "AHL (1.5%)", val: calcResult.ahl, color: "text-rose-400" },
                { label: "Pension EE (5%)", val: calcResult.defined_pension_ee, color: "text-rose-400" },
              ].map(({ label, val, color }) => (
                <div key={label} className={`flex justify-between ${color}`}>
                  <span>Less: {label}</span><span>–{fmt(val)}</span>
                </div>
              ))}
              <div className="flex justify-between text-zinc-500">
                <span>Taxable Pay</span><span>{fmt(calcResult.taxable_pay)}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Gross PAYE (slabs)</span><span>{fmt(calcResult.gross_paye)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Less: Personal Relief</span><span>–{fmt(calcResult.personal_relief)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Less: AHL Relief</span><span>–{fmt(calcResult.ahl_relief)}</span>
              </div>
              <div className="flex justify-between font-bold text-rose-600 border-t dark:border-zinc-800 pt-1.5">
                <span>NET PAYE</span><span>{fmt(calcResult.net_paye)}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Pension ER (10%)</span><span>{fmt(calcResult.defined_pension_er)}</span>
              </div>
              <div className="flex justify-between font-bold text-emerald-600 border-t-2 dark:border-zinc-700 pt-2 text-base">
                <span>NET SALARY</span><span>KES {fmt(calcResult.net_salary)}</span>
              </div>
            </div>

            {/* PAYE slab visual */}
            <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-900 p-3 space-y-1.5 mt-2">
              <p className="text-[9px] uppercase font-mono text-zinc-400 mb-2">Effective PAYE Slab Breakdown</p>
              {BANDS.map((band, i) => {
                const taxable = calcResult.taxable_pay
                const slabMax = [24000, 32333, 500000, 800000][i]
                const slabMin = [0, 24001, 32334, 500001, 800001][i]
                const inBand = Math.max(0, Math.min(taxable, slabMax ?? taxable) - (slabMin - 1))
                const pct = taxable > 0 ? (inBand / taxable) * 100 : 0
                return (
                  <div key={band.rate} className="space-y-0.5">
                    <div className="flex justify-between text-[9px] font-mono">
                      <span className="text-zinc-500">{band.range}</span>
                      <span className="text-zinc-700 dark:text-zinc-300">{band.rate}</span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-1.5">
                      <div
                        className="bg-zinc-700 dark:bg-zinc-300 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
    </ModuleLock>
  )
}
