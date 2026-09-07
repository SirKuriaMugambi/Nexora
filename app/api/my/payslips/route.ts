import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireEmployeeSelf } from "@/lib/supabase"
import { generatePayslipPDF, type PayrollEmployeeRecord } from "@/lib/payroll-backend"
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

// Downloads exactly one payslip PDF: the caller's own, for the requested
// month. guard.employeeId is resolved server-side from the session (see
// requireEmployeeSelf) and used as the ONLY employee_id filter on every
// query below — the month is the only thing the client controls, and it
// only ever narrows within this one employee's own data.
export async function GET(request: Request) {
  const guard = await requireEmployeeSelf()
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const month = new URL(request.url).searchParams.get("month")
  if (!month) {
    return NextResponse.json({ error: "month query param is required, e.g. ?month=2026-08" }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: run, error: runError } = await admin
    .from("payroll_runs")
    .select("id, status")
    .eq("month", month)
    .single()

  if (runError || !run) {
    return NextResponse.json({ error: `No payroll run found for month "${month}".` }, { status: 404 })
  }
  if (run.status !== "Approved" && run.status !== "Posted") {
    return NextResponse.json({ error: `Payslips for "${month}" aren't available yet.` }, { status: 409 })
  }

  const { data: entry, error: entryError } = await admin
    .from("payroll_register_entries")
    .select("*")
    .eq("payroll_run_id", run.id)
    .eq("employee_id", guard.employeeId)
    .single()

  if (entryError || !entry) {
    return NextResponse.json({ error: `No payslip found for you in "${month}".` }, { status: 404 })
  }

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, name, kra_pin, grade, cost_centre, department")
    .eq("id", guard.employeeId)
    .single()

  if (employeeError || !employee) {
    return NextResponse.json({ error: "Employee record not found." }, { status: 404 })
  }

  const record: PayrollEmployeeRecord = {
    id: employee.id,
    name: employee.name,
    kra_pin: employee.kra_pin,
    grade: employee.grade,
    cost_centre: employee.cost_centre,
    department: employee.department,
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

  const pdfBlob = generatePayslipPDF(record, month)
  const buffer = Buffer.from(await pdfBlob.arrayBuffer())

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payslip-${month}.pdf"`,
    },
  })
}
