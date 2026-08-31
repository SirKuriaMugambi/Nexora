import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { buildPayrollJournal, buildPayrollJournalCSV, type PayrollJournalEmployeeInput } from "@/lib/journal-builder"
import type { PayrollResult } from "@/lib/payroll-engine"

interface PayrollRegisterRow {
  employee_id: string
  basic_salary: number
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
    allowances: 0,
    deductions: row.total_deductions,
    nssf: row.nssf_t1 + row.nssf_t2,
    nhif: row.shif,
    paye: row.net_paye,
    net_salary: row.net_pay,
    total_deductions: row.total_deductions,
  }
}

// Downloads the same balanced Dr/Cr journal the "Post to AX" action builds,
// as a CSV — but read-only: it never calls the (currently mocked) Dynamics
// client and never changes the run's status. This is what gives an AX admin
// a real file to hand-import while we're still waiting on live API access
// and the 5 unconfirmed GL account codes (each row is tagged so it's obvious
// which ones are still placeholders — see lib/journal-builder.ts).
export async function GET(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const month = new URL(request.url).searchParams.get("month")
  if (!month) {
    return NextResponse.json({ error: "month query param is required, e.g. ?month=2026-08" }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .select("id, status")
    .eq("month", month)
    .single()

  if (runError || !run) {
    return NextResponse.json({ error: `No payroll run found for month "${month}".` }, { status: 404 })
  }

  if (run.status !== "Approved" && run.status !== "Posted") {
    return NextResponse.json(
      { error: `Cannot generate a GL journal for a run with status "${run.status}" — it must be Approved first.` },
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
    .select("id, department, cost_centre")
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
    }

    return {
      employee: { id: employee.id, department: employee.department, cost_centre: employee.cost_centre },
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
  // Excel opens a BOM-less CSV as Windows-1252, which mangles the em-dashes
  // in the title/description columns ("â€""). The BOM forces UTF-8.
  const csv = "﻿" + buildPayrollJournalCSV(journal)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chrysal-ax-gl-journal-${month}.csv"`,
    },
  })
}
