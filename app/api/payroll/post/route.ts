import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { buildPayrollJournal, type PayrollJournalEmployeeInput } from "@/lib/journal-builder"
import { createPayrollJournal, postPayrollJournal } from "@/lib/dynamics-ax-client"
import type { PayrollResult } from "@/lib/payroll-engine"

interface PayrollRegisterRow {
  employee_id: string
  basic_salary: number
  fringe_benefit: number
  gross_salary: number
  nssf_t1: number
  nssf_t2: number
  shif: number
  ahl: number
  defined_pension_ee: number
  employer_pension: number
  taxable_pay: number
  gross_paye: number
  personal_relief: number
  nhif_relief: number
  ahl_relief: number
  net_paye: number
  total_deductions: number
  net_pay: number
}

function toPayrollResult(row: PayrollRegisterRow): PayrollResult {
  return {
    gross_salary: row.gross_salary,
    nssf_t1: row.nssf_t1,
    nssf_t2: row.nssf_t2,
    shif: row.shif,
    ahl: row.ahl,
    defined_pension_ee: row.defined_pension_ee,
    defined_pension_er: row.employer_pension,
    taxable_pay: row.taxable_pay,
    gross_paye: row.gross_paye,
    personal_relief: row.personal_relief,
    nhif_relief: row.nhif_relief,
    ahl_relief: row.ahl_relief,
    net_paye: row.net_paye,
    allowances: 0, // not needed by the journal builder; not persisted per-run
    deductions: row.total_deductions,
    nssf: row.nssf_t1 + row.nssf_t2,
    nhif: row.shif,
    paye: row.net_paye,
    net_salary: row.net_pay,
    total_deductions: row.total_deductions,
  }
}

export async function POST(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const body = (await request.json()) as { month?: string }
  const month = body.month

  if (!month) {
    return NextResponse.json({ error: "month is required, e.g. { \"month\": \"2026-08\" }" }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json(
      { error: "Backend is not configured — cannot load a payroll run to post." },
      { status: 503 },
    )
  }

  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .select("id, status")
    .eq("month", month)
    .single()

  if (runError || !run) {
    return NextResponse.json({ error: `No payroll run found for month "${month}". Run /api/payroll first.` }, { status: 404 })
  }

  if (run.status !== "Approved") {
    return NextResponse.json(
      { error: `Cannot post a run with status "${run.status}" — it must be Approved first (submit, then have the finance manager approve it).` },
      { status: 409 },
    )
  }

  const { data: entries, error: entriesError } = await supabase
    .from("payroll_register_entries")
    .select("*")
    .eq("payroll_run_id", run.id)

  if (entriesError || !entries || entries.length === 0) {
    return NextResponse.json({ error: `No payroll register entries found for month "${month}".` }, { status: 404 })
  }

  const employeeIds = entries.map((e) => e.employee_id)
  const { data: employees, error: employeesError } = await supabase
    .from("employees")
    .select("id, department, cost_centre, cost_centre_allocation")
    .in("id", employeeIds)

  if (employeesError || !employees) {
    return NextResponse.json({ error: "Failed to load employee department/cost-centre data." }, { status: 500 })
  }

  const employeeById = new Map(employees.map((e) => [e.id, e]))

  const employeeInputs: PayrollJournalEmployeeInput[] = entries.map((entry) => {
    const employee = employeeById.get(entry.employee_id) ?? {
      id: entry.employee_id,
      department: "Production",
      cost_centre: "511",
      cost_centre_allocation: null,
    }

    return {
      employee: {
        id: employee.id,
        department: employee.department,
        cost_centre: employee.cost_centre,
        cost_centre_allocation: employee.cost_centre_allocation,
      },
      inputs: {
        base_salary: entry.basic_salary,
        bonus_commission: entry.bonus_commission,
        fringe_benefit: entry.fringe_benefit,
        transport_allowance: entry.transport_allowance,
        arrears: entry.arrears,
        ot_other: entry.ot_other,
        voluntary_pension: entry.voluntary_pension,
        advances: entry.advances,
        helb: entry.helb,
        company_loan: entry.company_loan,
        bank_loan: entry.bank_loan,
        sacco: entry.sacco,
      },
      result: toPayrollResult(entry as PayrollRegisterRow),
    }
  })

  const journal = buildPayrollJournal(month, employeeInputs)

  if (!journal.isBalanced) {
    return NextResponse.json(
      { error: "Journal does not balance — refusing to post.", journal },
      { status: 500 },
    )
  }

  const axPayload = createPayrollJournal(journal)
  const axResult = await postPayrollJournal(axPayload)

  if (axResult.success) {
    await supabase.from("payroll_runs").update({ status: "Posted" }).eq("id", run.id)
  }

  return NextResponse.json({ month, journal, axPayload, axResult })
}
