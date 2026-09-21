"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useFinOps } from "@/components/finops-provider"
import { useTheme } from "@/components/theme-provider"
import { IdCard, Plus, X, Pencil, Trash2, ShieldAlert, Lock, KeyRound } from "lucide-react"
import type { Employee } from "@/lib/seeds"
import ModuleLock from "@/components/module-lock"
import { FilterChips } from "@/components/filter-chips"
import { issueCauseOptions } from "@/components/preflight-panel"
import { PAYROLL_VALIDATION_FIX_FIELD, validatePayrollRows, type PayrollValidationCode } from "@/lib/payroll-validation"
import { EXCEPTION_KINDS, exceptionDetails, hasException, type ExceptionKind } from "@/lib/employee-exceptions"
import { CC_NAMES, departmentForCostCentre } from "@/lib/payroll-engine"
import { describeChanges, variablePayChanges, type VariablePayRow } from "@/lib/variable-pay"

// What the table can be narrowed to: a pre-flight cause, any exception, or one kind of exception.
type EmployeeFilter = PayrollValidationCode | "statutory_exception" | ExceptionKind
const isExceptionKind = (f: EmployeeFilter): f is ExceptionKind => EXCEPTION_KINDS.some((k) => k.key === f)

const NUMERIC_FIELDS = [
  "base_salary", "bonus_commission", "fringe_benefit", "transport_allowance",
  "arrears", "ot_other", "voluntary_pension", "advances", "helb",
  "company_loan", "bank_loan", "sacco", "personal_relief_override",
  "paye_band_flat_deduction", "pension_rate_override", "nssf_t2_override", "ahl_relief_override",
]

function fmt(n: number | undefined) {
  return (n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })
}

interface FieldProps {
  label: string
  name: string
  type?: string
  disabled?: boolean
  value: string | number | null | undefined
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function Field({ label, name, type = "text", disabled, value, onChange }: FieldProps) {
  return (
    <div className="space-y-0.5">
      <label className="text-[9px] font-mono uppercase text-zinc-400">{label}</label>
      <input
        name={name} type={type}
        disabled={disabled}
        value={value ?? ""}
        onChange={onChange}
        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 rounded disabled:opacity-50"
      />
    </div>
  )
}

interface EmployeeFormProps {
  initial?: Employee
  onSave: (emp: Partial<Employee>) => Promise<void>
  onCancel: () => void
  cardRadius: string
  buttonRadius: string
  accentBg: string
  /** Field to scroll to and focus once the form is on screen — the thing that needs fixing. */
  focusField?: string
}

// Portal Access: turns on an employee's self-service payslip portal. There's
// no password to generate or relay — they sign in with their email and the
// last 4 characters of their own KRA PIN, already on file here (see
// app/api/portal-login) — the same thing they already use to open their
// payslip PDF, so this is just an on/off switch, not a credential-handout
// step.
function PortalAccessSection({ employee, buttonRadius }: { employee: Employee; buttonRadius: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(Boolean(employee.portal_user_id))

  async function handleEnable() {
    if (busy || enabled) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/employees/${employee.id}/portal-access`, { method: "POST" })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to set up portal access.")
      }
      setEnabled(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set up portal access.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-1 border-t dark:border-zinc-800 space-y-2">
      <p className="text-[9px] font-mono uppercase text-zinc-400 flex items-center gap-1">
        <KeyRound className="h-3 w-3" /> Self-Service Portal Access
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[10px] font-mono ${enabled ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
          {enabled ? "Portal access enabled — they sign in with email + last 4 of their KRA PIN" : "No portal access yet"}
        </span>
        {!enabled && (
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy || !employee.email || !employee.kra_pin}
            title={!employee.email ? "Add an email above first" : !employee.kra_pin ? "Add a KRA PIN above first" : undefined}
            className={`px-3 py-1.5 font-mono text-[9px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${buttonRadius}`}
          >
            <KeyRound className="h-3 w-3" />
            <span>{busy ? "Working…" : "Enable Portal Access"}</span>
          </button>
        )}
      </div>

      {error && <p className="text-[10px] font-mono text-rose-500">{error}</p>}
    </div>
  )
}

// Where the pre-flight panel and the import preview send people: an employee
// to open at a field, or a new employee to add. Read once from the URL on the
// client; the server render sees nothing, and nothing on screen depends on it
// until the employee list has loaded, so there is no hydration mismatch.
interface DeepLink { edit?: string; field?: string; add?: Partial<Employee> }
function readDeepLink(): DeepLink | null {
  if (typeof window === "undefined") return null
  const q = new URLSearchParams(window.location.search)
  const edit = q.get("edit"), add = q.get("add")
  if (edit) return { edit, field: q.get("field") ?? undefined }
  if (add) {
    const basic = Number(q.get("basic"))
    return { add: { id: add, name: q.get("name") ?? "", base_salary: Number.isFinite(basic) && basic > 0 ? basic : 0 } }
  }
  return null
}

function EmployeeForm({ initial, onSave, onCancel, cardRadius, buttonRadius, accentBg, focusField }: EmployeeFormProps) {
  const blank: Partial<Employee> = {
    id: "", name: "", national_id: "", kra_pin: "", sha_pin: "",
    grade: "Staff", cost_centre: "511", department: CC_NAMES["511"],
    bank_name: "", bank_account_number: "", bank_branch_code: "", emp_code: "", email: "",
    base_salary: 0, bonus_commission: 0, fringe_benefit: 0, transport_allowance: 0,
    arrears: 0, ot_other: 0, voluntary_pension: 0,
    advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0,
    personal_relief_override: null, paye_band_flat_deduction: null,
    pension_rate_override: null, nssf_t2_override: null, ahl_relief_override: null,
  }
  const [form, setForm] = useState<Partial<Employee>>(initial ?? blank)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!focusField) return
    const el = document.querySelector<HTMLElement>(`[name="${focusField}"]`)
    if (!el) return
    el.scrollIntoView({ block: "center", behavior: "smooth" })
    el.focus()
    // A brief ring so the eye lands on the right box, then back to normal.
    el.classList.add("ring-2", "ring-amber-500")
    const t = setTimeout(() => el.classList.remove("ring-2", "ring-amber-500"), 2500)
    return () => clearTimeout(t)
  }, [focusField])

  function handle(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked
      setForm((f) => ({ ...f, [name]: checked }))
      return
    }
    if (name === "cost_centre") {
      // Department follows the cost centre — the two drifted apart once and
      // every payslip and journal line carried the wrong department.
      setForm((f) => ({ ...f, cost_centre: value, department: departmentForCostCentre(value, f.cost_centre_allocation) }))
      return
    }
    setForm((f) => ({ ...f, [name]: NUMERIC_FIELDS.includes(name) ? (value === "" ? null : parseFloat(value) || 0) : value }))
  }

  async function save() {
    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  function fieldValue(n: string): string | number | null {
    return (form as Record<string, unknown>)[n] as string | number | null
  }

  return (
    <div className={`p-5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 space-y-4 ${cardRadius}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono uppercase tracking-wider font-bold">
          {initial ? `Edit Employee — ${initial.id}` : "Add Employee"}
        </h3>
        <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
      </div>

      <p className="text-[9px] font-mono uppercase text-zinc-400">Identity</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Staff No (ID)" name="id" value={fieldValue("id")} onChange={handle} disabled={initial !== undefined} />
        <Field label="Name" name="name" value={fieldValue("name")} onChange={handle} />
        <Field label="National ID" name="national_id" value={fieldValue("national_id")} onChange={handle} />
        <Field label="KRA PIN" name="kra_pin" value={fieldValue("kra_pin")} onChange={handle} />
        <Field label="SHA/NHIF PIN" name="sha_pin" value={fieldValue("sha_pin")} onChange={handle} />
        <Field label="Grade" name="grade" value={fieldValue("grade")} onChange={handle} />
        <div className="space-y-0.5">
          <label className="text-[9px] font-mono uppercase text-zinc-400">Cost Centre</label>
          <select name="cost_centre" value={form.cost_centre ?? "511"} onChange={handle}
            className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] font-mono focus:outline-none rounded">
            <option value="121">121 — Finance</option>
            <option value="204">204 — Technical (TC)</option>
            <option value="205">205 — OAT</option>
            <option value="206">206 — Technical Assistants</option>
            <option value="511">511 — Production</option>
            <option value="512">512 — Production-OH</option>
          </select>
        </div>
        <div className="space-y-0.5">
          <label className="text-[9px] font-mono uppercase text-zinc-400">Department</label>
          <select name="department" value={form.department ?? "Production"} onChange={handle}
            className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] font-mono focus:outline-none rounded">
            {Object.entries(CC_NAMES).map(([cc, name]) => (
              <option key={cc} value={name}>{name}</option>
            ))}
            <option value="General Manager">General Manager</option>
          </select>
        </div>
      </div>

      <p className="text-[9px] font-mono uppercase text-zinc-400 pt-1 border-t dark:border-zinc-800">Bank Details</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bank Name" name="bank_name" value={fieldValue("bank_name")} onChange={handle} />
        <Field label="Bank Account Number" name="bank_account_number" value={fieldValue("bank_account_number")} onChange={handle} />
        <Field label="Bank Branch Code (bank file, e.g. 03095)" name="bank_branch_code" value={fieldValue("bank_branch_code")} onChange={handle} />
        <Field label="EMP Code (bank file reference, e.g. EMP001)" name="emp_code" value={fieldValue("emp_code")} onChange={handle} />
        <Field label="Email (for payslip delivery)" name="email" type="email" value={fieldValue("email")} onChange={handle} />
      </div>

      <p className="text-[9px] font-mono uppercase text-zinc-400 pt-1 border-t dark:border-zinc-800">Earnings</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Basic Salary" name="base_salary" type="number" value={fieldValue("base_salary")} onChange={handle} />
        <Field label="Bonus / Commission" name="bonus_commission" type="number" value={fieldValue("bonus_commission")} onChange={handle} />
        <Field label="Fringe Benefit (FBT)" name="fringe_benefit" type="number" value={fieldValue("fringe_benefit")} onChange={handle} />
        <Field label="Transport Allowance" name="transport_allowance" type="number" value={fieldValue("transport_allowance")} onChange={handle} />
        <Field label="Arrears" name="arrears" type="number" value={fieldValue("arrears")} onChange={handle} />
        <Field label="OT / Other" name="ot_other" type="number" value={fieldValue("ot_other")} onChange={handle} />
      </div>

      <p className="text-[9px] font-mono uppercase text-zinc-400 pt-1 border-t dark:border-zinc-800">Deductions (Post-Tax)</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Voluntary Pension" name="voluntary_pension" type="number" value={fieldValue("voluntary_pension")} onChange={handle} />
        <Field label="Advances" name="advances" type="number" value={fieldValue("advances")} onChange={handle} />
        <Field label="HELB" name="helb" type="number" value={fieldValue("helb")} onChange={handle} />
        <Field label="Company Loan" name="company_loan" type="number" value={fieldValue("company_loan")} onChange={handle} />
        <Field label="Bank Loan" name="bank_loan" type="number" value={fieldValue("bank_loan")} onChange={handle} />
        <Field label="SACCO" name="sacco" type="number" value={fieldValue("sacco")} onChange={handle} />
      </div>

      <p className="text-[9px] font-mono uppercase text-zinc-400 pt-1 border-t dark:border-zinc-800 flex items-center gap-1">
        <ShieldAlert className="h-3 w-3" /> Statutory Exceptions (confirmed cases only — leave blank otherwise)
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Personal Relief Override (blank = standard 2,400)" name="personal_relief_override" type="number" value={fieldValue("personal_relief_override")} onChange={handle} />
        <Field label="Pension Rate Override, decimal (blank = standard 0.05)" name="pension_rate_override" type="number" value={fieldValue("pension_rate_override")} onChange={handle} />
        <Field label="PAYE Band Flat Deduction (blank = standard basis)" name="paye_band_flat_deduction" type="number" value={fieldValue("paye_band_flat_deduction")} onChange={handle} />
        <Field label="NSSF Tier II Override (blank = standard flat 1,740)" name="nssf_t2_override" type="number" value={fieldValue("nssf_t2_override")} onChange={handle} />
        <Field label="AHL Relief Override (blank = standard 15% of AHL)" name="ahl_relief_override" type="number" value={fieldValue("ahl_relief_override")} onChange={handle} />
      </div>
      <p className="text-[9px] text-zinc-400 font-mono">
        Statutory items (NSSF, SHIF, AHL, PAYE) are computed automatically from earnings — see Payroll &amp; PAYE.
      </p>

      {initial && <PortalAccessSection employee={initial} buttonRadius={buttonRadius} />}

      <div className="flex gap-2 pt-2">
        <button onClick={save} disabled={saving} className={`flex-1 py-2 font-mono text-[10px] uppercase tracking-wider font-bold disabled:opacity-50 ${accentBg} ${buttonRadius}`}>
          {saving ? "Saving…" : initial ? "Update Employee" : "Add Employee"}
        </button>
        <button onClick={onCancel} className="px-4 py-2 border border-zinc-200 dark:border-zinc-800 font-mono text-[10px] uppercase rounded">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function EmployeesPage() {
  const { addAuditLog, currentUserRole, authLoading } = useFinOps()
  const { cardRadius, buttonRadius, accentBg, accentBadge } = useTheme()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(() => Boolean(readDeepLink()?.add))
  const [deepLink, setDeepLink] = useState<DeepLink | null>(readDeepLink)
  const [editId, setEditId] = useState<string | null>(() => readDeepLink()?.edit ?? null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<EmployeeFilter | null>(null)
  // This month's variable pay, so each row can say whether the person is on
  // standard pay or what has changed — the same view the payroll register has.
  const [thisMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [variablePay, setVariablePay] = useState<VariablePayRow[]>([])

  // Reload after a CRUD mutation (create/update/delete) — kept out of the
  // initial-mount effect below since it's called from multiple places.
  async function refreshVariablePay() {
    try {
      const res = await fetch(`/api/variable-pay?month=${thisMonth}`)
      if (!res.ok) return
      const json = (await res.json()) as { rows?: VariablePayRow[] }
      setVariablePay(json.rows ?? [])
    } catch {
      /* the indicator is informational; the table still renders */
    }
  }

  async function refreshEmployees() {
    void refreshVariablePay()
    try {
      const response = await fetch("/api/employees")
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? "Failed to load employees")
      setEmployees(payload.employees ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load employees")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let ignore = false

    async function loadInitialEmployees() {
      try {
        const response = await fetch("/api/employees")
        const payload = await response.json()
        if (ignore) return
        if (!response.ok) throw new Error(payload.error ?? "Failed to load employees")
        setEmployees(payload.employees ?? [])
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Failed to load employees")
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadInitialEmployees()
    return () => { ignore = true }
  }, [])

  const editing = useMemo(() => employees.find((e) => e.id === editId), [employees, editId])
  useEffect(() => {
    if (employees.length > 0 && window.location.search) window.history.replaceState(null, "", window.location.pathname)
  }, [employees.length])

  // Open an employee at the field that fixes one of their issues.
  function openAtField(id: string, field: string) {
    setShowAddForm(false)
    setEditId(id)
    setDeepLink({ edit: id, field })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function handleCreate(form: Partial<Employee>) {
    const response = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    const payload = await response.json()
    if (!response.ok) {
      addAuditLog("EMPLOYEE CREATE FAILED", form.id ?? "unknown", payload.error ?? "Unknown error")
      setError(payload.error ?? "Failed to create employee")
      return
    }
    addAuditLog("EMPLOYEE CREATED", form.id ?? "", `Added ${form.name} (${form.id}) to the employee master.`)
    setShowAddForm(false)
    await refreshEmployees()
  }

  async function handleUpdate(form: Partial<Employee>) {
    if (!editId) return
    const response = await fetch(`/api/employees/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    const payload = await response.json()
    if (!response.ok) {
      addAuditLog("EMPLOYEE UPDATE FAILED", editId, payload.error ?? "Unknown error")
      setError(payload.error ?? "Failed to update employee")
      return
    }
    addAuditLog("EMPLOYEE UPDATED", editId, `Updated master data for ${form.name ?? editId}.`)
    setEditId(null)
    await refreshEmployees()
  }

  async function handleDelete(emp: Employee) {
    if (!window.confirm(`Remove ${emp.name} (${emp.id}) from the employee master? This cannot be undone here.`)) {
      return
    }
    const response = await fetch(`/api/employees/${emp.id}`, { method: "DELETE" })
    const payload = await response.json()
    if (!response.ok) {
      addAuditLog("EMPLOYEE DELETE FAILED", emp.id, payload.error ?? "Unknown error")
      setError(payload.error ?? "Failed to delete employee")
      return
    }
    addAuditLog("EMPLOYEE DELETED", emp.id, `Removed ${emp.name} (${emp.id}) from the employee master.`)
    await refreshEmployees()
  }

  const exceptionCount = employees.filter(hasException).length

  // The same pre-flight checks the Payroll page shows, run here so the
  // finance manager can press "46 × no email" on that page, come here, and
  // land on exactly those 46 rows. Net pay is not computed on this page, so
  // the negative-net check can never fire here — every other cause can.
  const issues = useMemo(
    () => validatePayrollRows(employees.map((e) => ({
      id: e.id, name: e.name, kra_pin: e.kra_pin, base_salary: e.base_salary, net_salary: 0,
      bank_name: e.bank_name, bank_account_number: e.bank_account_number,
      bank_branch_code: e.bank_branch_code, emp_code: e.emp_code, email: e.email,
    }))),
    [employees],
  )
  const filterOptions = useMemo(() => {
    const opts: Array<{ key: EmployeeFilter; label: string; count: number }> = issueCauseOptions(issues)
    if (exceptionCount > 0) opts.push({ key: "statutory_exception", label: "any statutory exception", count: exceptionCount })
    for (const kind of EXCEPTION_KINDS) {
      const count = employees.filter(kind.isSet).length
      if (count > 0) opts.push({ key: kind.key, label: kind.label, count })
    }
    return opts
  }, [issues, exceptionCount, employees])
  // Reason shown under the name while a filter is active: the pre-flight
  // message for a cause, or the exception(s) spelled out with their values.
  const reasonFor = useMemo(() => {
    const map = new Map<string, { message: string; field: string }>()
    if (!filter) return map
    if (filter === "statutory_exception" || isExceptionKind(filter)) {
      const only = filter === "statutory_exception" ? undefined : filter
      for (const e of employees) {
        const details = exceptionDetails(e, only)
        if (details.length === 0) continue
        const field = only ?? EXCEPTION_KINDS.find((k) => k.isSet(e))?.key ?? "pension_rate_override"
        map.set(e.id, { message: details.join(" · "), field })
      }
      return map
    }
    for (const i of issues) {
      if (i.code === filter && !map.has(i.employeeId)) {
        map.set(i.employeeId, { message: i.message, field: i.field ?? PAYROLL_VALIDATION_FIX_FIELD[i.code] })
      }
    }
    return map
  }, [issues, employees, filter])
  const changesFor = useMemo(() => {
    const byEmployee = new Map<string, VariablePayRow[]>()
    for (const r of variablePay) byEmployee.set(r.employee_id, [...(byEmployee.get(r.employee_id) ?? []), r])
    return new Map(employees.map((e) => [e.id, variablePayChanges(e, byEmployee.get(e.id) ?? [])]))
  }, [employees, variablePay])

  const visibleEmployees = useMemo(
    () => (filter ? employees.filter((e) => reasonFor.has(e.id)) : employees),
    [employees, filter, reasonFor],
  )

  // Employee master holds PII/bank details — finance_manager only. Real
  // enforcement is server-side (every /api/employees* route checks this
  // too); this just keeps the UI from rendering the data before that 403s.
  if (!authLoading && currentUserRole !== "finance_manager") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
        <Lock className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
        <h1 className="text-sm font-bold font-mono uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Access Restricted</h1>
        <p className="text-zinc-400 text-xs max-w-sm">
          Employee Master holds personal and bank data restricted to the Finance Manager role. Contact your
          administrator if you believe you should have access.
        </p>
      </div>
    )
  }

  return (
    <ModuleLock moduleName="Employee Master Data">
    <div className="space-y-6">
      <div className="pb-3 border-b border-zinc-200 dark:border-zinc-900 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="text-base font-bold font-mono uppercase tracking-wider">Employee Master Data</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-xs max-w-2xl">
            Single source of truth for employee identity, bank details, salary structure, and statutory
            exceptions. Payroll runs read from this data — never re-typed.
          </p>
        </div>
        <button
          onClick={() => { setShowAddForm(true); setEditId(null) }}
          className={`px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 shrink-0 ${accentBg} ${buttonRadius}`}
        >
          <Plus className="h-3.5 w-3.5" /><span>Add Employee</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Headcount", value: employees.length.toString() },
          { label: "Statutory Exceptions", value: exceptionCount.toString() },
          { label: "Placeholder Cost Centres", value: employees.filter((e) => e.cost_centre === "511").length.toString() },
        ].map((card) => (
          <div key={card.label} className={`p-4 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 flex flex-col justify-between h-16 ${cardRadius}`}>
            <span className="text-[9px] font-mono uppercase text-zinc-400">{card.label}</span>
            <span className="text-sm font-bold font-mono text-zinc-800 dark:text-zinc-100">{card.value}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">
          {error}
        </div>
      )}

      {showAddForm && (
        <EmployeeForm
          initial={deepLink?.add ? ({ ...deepLink.add } as Employee) : undefined}
          focusField={deepLink?.add ? "kra_pin" : undefined}
          onSave={handleCreate}
          onCancel={() => setShowAddForm(false)}
          cardRadius={cardRadius}
          buttonRadius={buttonRadius}
          accentBg={accentBg}
        />
      )}

      {editing && (
        <EmployeeForm
          key={editing.id}
          initial={editing}
          focusField={deepLink?.edit === editing.id ? deepLink.field : undefined}
          onSave={handleUpdate}
          onCancel={() => setEditId(null)}
          cardRadius={cardRadius}
          buttonRadius={buttonRadius}
          accentBg={accentBg}
        />
      )}

      <div className={`border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 overflow-hidden ${cardRadius}`}>
        <div className="px-5 py-3 border-b dark:border-zinc-900 flex items-center gap-2">
          <IdCard className="h-4 w-4 text-zinc-400" />
          <h3 className="text-xs font-mono uppercase tracking-wider font-bold">Employee Master ({employees.length})</h3>
        </div>
        {!loading && filterOptions.length > 0 && (
          <div className="px-5 py-2.5 border-b dark:border-zinc-900 space-y-1.5">
            <FilterChips options={filterOptions} active={filter} onChange={setFilter} total={employees.length} tone="amber" />
            {filter && (
              <p className="font-mono text-[10px] text-amber-600 dark:text-amber-400">
                Showing {visibleEmployees.length} of {employees.length} — {filterOptions.find((o) => o.key === filter)?.label}
              </p>
            )}
          </div>
        )}

        {loading && (
          <div className="p-5 text-[10px] font-mono uppercase text-zinc-400">Loading employee master from Supabase…</div>
        )}

        {!loading && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-900 text-zinc-400 font-mono text-[9px] uppercase tracking-wider">
                  <th className="px-4 py-2.5">Staff</th>
                  <th className="px-4 py-2.5">KRA PIN</th>
                  <th className="px-4 py-2.5">Grade</th>
                  <th className="px-4 py-2.5">Cost Centre</th>
                  <th className="px-4 py-2.5">Bank</th>
                  <th className="px-4 py-2.5 text-right">Basic Salary</th>
                  <th className="px-4 py-2.5">This month</th>
                  <th className="px-4 py-2.5 text-center">Exceptions</th>
                  <th className="px-4 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900 text-[11px]">
                {visibleEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-zinc-800 dark:text-zinc-200">{emp.name}</p>
                      <span className="text-[9px] text-zinc-400 font-mono">{emp.id}</span>
                      {reasonFor.has(emp.id) && (
                        <button
                          type="button"
                          onClick={() => openAtField(emp.id, reasonFor.get(emp.id)!.field)}
                          title="Open this employee at the field to fix"
                          className="block mt-0.5 text-left text-[9px] text-amber-600 dark:text-amber-400 underline underline-offset-2 hover:opacity-80"
                        >
                          {reasonFor.get(emp.id)!.message} — Fix →
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-500">{emp.kra_pin}</td>
                    <td className="px-4 py-3 font-mono text-zinc-500">{emp.grade}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 ${accentBadge}`}>{emp.cost_centre}</span>
                      <span className="block text-[9px] text-zinc-400 font-mono mt-0.5">{emp.department}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-500 text-[10px]">
                      {emp.bank_name && emp.bank_name !== "N/A" ? `${emp.bank_name} · ${emp.bank_account_number}` : (
                        <span className="text-amber-500">Not on file</span>
                      )}
                      <span className={`block mt-0.5 text-[9px] ${emp.bank_branch_code && emp.emp_code ? "text-zinc-400" : "text-amber-500"}`}>
                        {emp.bank_branch_code && emp.emp_code
                          ? `Br ${emp.bank_branch_code} · ${emp.emp_code}`
                          : "Branch code / EMP code missing — bank file will refuse"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(emp.base_salary)}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const changes = changesFor.get(emp.id) ?? []
                        return changes.length === 0 ? (
                          <Link href={`/variable-pay?month=${thisMonth}&employee=${emp.id}`} title="Standard pay this month — click to add variable pay"
                            className="font-mono text-[9px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400 whitespace-nowrap hover:opacity-80">
                            No changes
                          </Link>
                        ) : (
                          <Link href={`/variable-pay?month=${thisMonth}&employee=${emp.id}`} title={describeChanges(changes)}
                            className="block font-mono text-[9px] text-amber-800 dark:text-amber-300 hover:opacity-80">
                            <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 whitespace-nowrap">{changes.length} change{changes.length === 1 ? "" : "s"}</span>
                            <span className="block mt-1 max-w-[220px] whitespace-normal text-[9px]">{describeChanges(changes)}</span>
                          </Link>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {hasException(emp) ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-mono text-amber-600 dark:text-amber-400">
                          <ShieldAlert className="h-3 w-3" /> Yes
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-zinc-300 dark:text-zinc-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => { setEditId(emp.id); setShowAddForm(false) }}
                          className={`p-1 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5 text-zinc-400" />
                        </button>
                        <button
                          onClick={() => handleDelete(emp)}
                          className={`p-1 border border-zinc-200 dark:border-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 ${buttonRadius}`}
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </ModuleLock>
  )
}
