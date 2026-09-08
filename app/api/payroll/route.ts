import { NextResponse } from "next/server"
import { initialEmployees } from "@/lib/seeds"
import { buildPayrollVarianceReport, computePayroll, type EmployeeSummary } from "@/lib/payroll-engine"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { KENYA_PAYROLL_RULES_2024 as RULES } from "@/lib/payroll-rules-config"

function normalizeEmployeeRow(row: Record<string, unknown>) {
  const input = {
    base_salary: Number(row.base_salary ?? 0),
    bonus_commission: Number(row.bonus_commission ?? 0),
    fringe_benefit: Number(row.fringe_benefit ?? 0),
    transport_allowance: Number(row.transport_allowance ?? 0),
    arrears: Number(row.arrears ?? 0),
    ot_other: Number(row.ot_other ?? 0),
    voluntary_pension: Number(row.voluntary_pension ?? 0),
    advances: Number(row.advances ?? 0),
    helb: Number(row.helb ?? 0),
    company_loan: Number(row.company_loan ?? 0),
    bank_loan: Number(row.bank_loan ?? 0),
    sacco: Number(row.sacco ?? 0),
    personal_relief_override: row.personal_relief_override != null ? Number(row.personal_relief_override) : undefined,
    paye_band_flat_deduction: row.paye_band_flat_deduction != null ? Number(row.paye_band_flat_deduction) : undefined,
    pension_rate_override: row.pension_rate_override != null ? Number(row.pension_rate_override) : undefined,
    nssf_t2_override: row.nssf_t2_override != null ? Number(row.nssf_t2_override) : undefined,
    ahl_relief_override: row.ahl_relief_override != null ? Number(row.ahl_relief_override) : undefined,
  }

  const result = computePayroll(input)

  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    kra_pin: String(row.kra_pin ?? ""),
    grade: String(row.grade ?? ""),
    cost_centre: String(row.cost_centre ?? "511"),
    cost_centre_allocation: (row.cost_centre_allocation as Record<string, number> | null) ?? null,
    department: String(row.department ?? "Production"),
    // Not used in any calculation — carried through so the payroll page can
    // run pre-flight validation (missing bank details / email warnings).
    bank_name: row.bank_name != null ? String(row.bank_name) : null,
    bank_account_number: row.bank_account_number != null ? String(row.bank_account_number) : null,
    email: row.email != null ? String(row.email) : null,
    base_salary: input.base_salary,
    bonus_commission: input.bonus_commission,
    fringe_benefit: input.fringe_benefit,
    transport_allowance: input.transport_allowance,
    arrears: input.arrears,
    ot_other: input.ot_other,
    gross_salary: result.gross_salary,
    voluntary_pension: input.voluntary_pension,
    defined_pension_ee: result.defined_pension_ee,
    defined_pension_er: result.defined_pension_er,
    nssf_t1: result.nssf_t1,
    nssf_t2: result.nssf_t2,
    shif: result.shif,
    ahl: result.ahl,
    taxable_pay: result.taxable_pay,
    gross_paye: result.gross_paye,
    personal_relief: result.personal_relief,
    nhif_relief: result.nhif_relief,
    ahl_relief: result.ahl_relief,
    net_paye: result.net_paye,
    advances: input.advances,
    helb: input.helb,
    company_loan: input.company_loan,
    bank_loan: input.bank_loan,
    sacco: input.sacco,
    allowances: result.allowances,
    deductions: result.deductions,
    nssf: result.nssf,
    nhif: result.nhif,
    paye: result.paye,
    net_salary: result.net_salary,
    total_deductions: result.total_deductions,
  }
}

export async function GET(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const supabase = createSupabaseAdminClient()
  const month = new URL(request.url).searchParams.get("month")

  let run: { status: string } | null = null
  if (supabase && month) {
    const { data } = await supabase.from("payroll_runs").select("status").eq("month", month).single()
    run = data ?? null
  }

  if (supabase) {
    const { data, error } = await supabase.from("employees").select("*").order("name")
    if (!error && Array.isArray(data)) {
      return NextResponse.json({ employees: data.map((row) => normalizeEmployeeRow(row as Record<string, unknown>)), run })
    }
  }

  return NextResponse.json({ employees: initialEmployees, run })
}

export async function POST(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const body = (await request.json()) as {
    month?: string
    employees?: Array<{
      id: string
      name: string
      kra_pin: string
      grade?: string
      cost_centre?: string
      department?: string
      base_salary: number
      bonus_commission: number
      fringe_benefit: number
      transport_allowance: number
      arrears: number
      ot_other: number
      voluntary_pension: number
      advances: number
      helb: number
      company_loan: number
      bank_loan: number
      sacco: number
      personal_relief_override?: number
      paye_band_flat_deduction?: number
      pension_rate_override?: number
      nssf_t2_override?: number
      ahl_relief_override?: number
    }>
  }

  const employees = body.employees ?? []
  const month = body.month ?? new Date().toISOString().slice(0, 7)

  // Refuse to create an empty run. Previously this happily saved a Draft with
  // zero register entries (e.g. if the page posted before its employee list
  // had loaded), which then passed Submit/Approve and only surfaced later as
  // "No payroll register entries found" when generating payslips or the journal.
  if (employees.length === 0) {
    return NextResponse.json(
      { error: "No employees supplied — refusing to save an empty payroll run." },
      { status: 400 },
    )
  }

  // Keep each employee's FULL computed result — the register entries below
  // persist taxable_pay/gross_paye/reliefs, which the payslip PDF and iTax
  // export read back. (These used to be written as hardcoded 0/2400
  // placeholders, so every generated payslip showed Taxable Pay 0.)
  const computed = employees.map((employee) => ({
    employee,
    result: computePayroll({
      base_salary: employee.base_salary,
      bonus_commission: employee.bonus_commission,
      fringe_benefit: employee.fringe_benefit,
      transport_allowance: employee.transport_allowance,
      arrears: employee.arrears,
      ot_other: employee.ot_other,
      voluntary_pension: employee.voluntary_pension,
      advances: employee.advances,
      helb: employee.helb,
      company_loan: employee.company_loan,
      bank_loan: employee.bank_loan,
      sacco: employee.sacco,
      personal_relief_override: employee.personal_relief_override,
      paye_band_flat_deduction: employee.paye_band_flat_deduction,
      pension_rate_override: employee.pension_rate_override,
      nssf_t2_override: employee.nssf_t2_override,
      ahl_relief_override: employee.ahl_relief_override,
    }),
  }))

  // Server-side pre-flight gate — mirrors lib/payroll-validation.ts's error
  // checks (the client also blocks these, but the API is the real gate).
  // Warnings (missing bank/email) don't block: those degrade downstream
  // outputs rather than making the run itself wrong.
  const blocking = computed.filter(
    ({ employee, result }) =>
      !employee.kra_pin?.trim() || employee.base_salary <= 0 || result.net_salary < 0,
  )
  if (blocking.length > 0) {
    return NextResponse.json(
      {
        error:
          `Refusing to save: ${blocking.length} employee(s) failed pre-flight checks ` +
          `(${blocking.slice(0, 5).map(({ employee }) => employee.id).join(", ")}${blocking.length > 5 ? ", …" : ""}) — ` +
          "missing KRA PIN, non-positive basic salary, or negative net pay.",
      },
      { status: 400 },
    )
  }

  const payrollRun = computed.map(({ employee, result }) => ({
    id: employee.id,
    name: employee.name,
    kra_pin: employee.kra_pin,
    cost_centre: employee.cost_centre ?? "511",
    gross_salary: result.gross_salary,
    net_paye: result.net_paye,
    nssf_t1: result.nssf_t1,
    nssf_t2: result.nssf_t2,
    shif: result.shif,
    ahl: result.ahl,
    defined_pension_ee: result.defined_pension_ee,
    defined_pension_er: result.defined_pension_er,
    helb: employee.helb,
    company_loan: employee.company_loan,
    bank_loan: employee.bank_loan,
    sacco: employee.sacco,
    advances: employee.advances,
    net_salary: result.net_salary,
    fringe_benefit: employee.fringe_benefit ?? 0,
  } satisfies EmployeeSummary))

  const variance = buildPayrollVarianceReport(payrollRun)

  const supabase = createSupabaseAdminClient()
  if (supabase) {
    // A recompute may only overwrite a Draft or Rejected run. Without this
    // guard the upsert below would silently demote a Submitted/Approved/
    // Posted run back to Draft and rewrite its register — including a run
    // already posted to AX, which must stay immutable as the audit record.
    const { data: existingRun } = await supabase
      .from("payroll_runs")
      .select("status")
      .eq("month", month)
      .maybeSingle()

    if (existingRun && existingRun.status !== "Draft" && existingRun.status !== "Rejected") {
      return NextResponse.json(
        {
          error:
            `The ${month} run is already "${existingRun.status}" and cannot be recomputed. ` +
            (existingRun.status === "Submitted"
              ? "Reject it first if the numbers need to change."
              : "Approved/Posted runs are locked as the audit record."),
        },
        { status: 409 },
      )
    }

    const { data: runData, error: runError } = await supabase
      .from("payroll_runs")
      .upsert({ month, status: "Draft" }, { onConflict: "month" })
      .select("id")
      .single()

    if (runError || !runData?.id) {
      return NextResponse.json(
        { error: `Failed to save the payroll run: ${runError?.message ?? "no run id returned"}` },
        { status: 500 },
      )
    }

    // Column names here must match public.payroll_register_entries exactly —
    // employer pension lives in `employer_pension`, and an earlier version
    // also sent a non-existent `defined_pension_er`, which made Postgres
    // reject the whole batch. That error was never checked, so runs silently
    // ended up with zero entries; it is checked below now.
    const entries = computed.map(({ employee, result }) => ({
      payroll_run_id: runData.id,
      employee_id: employee.id,
      basic_salary: employee.base_salary,
      bonus_commission: employee.bonus_commission,
      fringe_benefit: employee.fringe_benefit,
      transport_allowance: employee.transport_allowance,
      arrears: employee.arrears,
      ot_other: employee.ot_other,
      voluntary_pension: employee.voluntary_pension,
      advances: employee.advances,
      helb: employee.helb,
      company_loan: employee.company_loan,
      bank_loan: employee.bank_loan,
      sacco: employee.sacco,
      gross_salary: result.gross_salary,
      nssf_t1: result.nssf_t1,
      nssf_t2: result.nssf_t2,
      shif: result.shif,
      ahl: result.ahl,
      defined_pension_ee: result.defined_pension_ee,
      taxable_pay: result.taxable_pay,
      gross_paye: result.gross_paye,
      personal_relief: result.personal_relief,
      nhif_relief: result.nhif_relief,
      ahl_relief: result.ahl_relief,
      net_paye: result.net_paye,
      total_deductions: result.total_deductions,
      net_pay: result.net_salary,
      employer_pension: result.defined_pension_er,
      nita: RULES.nitaFlatPerEmployee,
    }))

    const { error: entriesError } = await supabase
      .from("payroll_register_entries")
      .upsert(entries, { onConflict: "payroll_run_id,employee_id" })

    if (entriesError) {
      return NextResponse.json(
        { error: `Failed to save payroll register entries: ${entriesError.message}` },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({
    month,
    headcount: payrollRun.length,
    totals: {
      gross_salary: payrollRun.reduce((s, e) => s + e.gross_salary, 0),
      net_salary: payrollRun.reduce((s, e) => s + e.net_salary, 0),
      paye: payrollRun.reduce((s, e) => s + e.net_paye, 0),
      nssf: payrollRun.reduce((s, e) => s + e.nssf_t1 + e.nssf_t2, 0),
      shif: payrollRun.reduce((s, e) => s + e.shif, 0),
      ahl: payrollRun.reduce((s, e) => s + e.ahl, 0),
    },
    variance,
    employees: payrollRun,
    persistedToSupabase: Boolean(supabase),
  })
}
