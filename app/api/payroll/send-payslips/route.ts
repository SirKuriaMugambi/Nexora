import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { generatePayslipPDF, type PayrollEmployeeRecord } from "@/lib/payroll-backend"
import { sendPayslipEmail, isEmailConfigured } from "@/lib/email"
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

function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number)
  return new Date(year, (m ?? 1) - 1, 1).toLocaleString("en-KE", { month: "long", year: "numeric" })
}

// Emails each employee their own payslip PDF individually — only once a run
// is Approved or Posted, matching the same gate as the bulk PDF download.
// Employees with no email on file are skipped, not treated as a failure.
export async function POST(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email sending is not configured. Set RESEND_API_KEY to enable this." },
      { status: 503 },
    )
  }

  const body = (await request.json()) as { month?: string }
  const month = body.month
  if (!month) {
    return NextResponse.json({ error: "month is required, e.g. { \"month\": \"2026-08\" }" }, { status: 400 })
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
      { error: `Cannot send payslips for a run with status "${run.status}" — it must be Approved first.` },
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
  const { data: employees } = await supabase
    .from("employees")
    .select("id, name, kra_pin, grade, cost_centre, department, email")
    .in("id", employeeIds)

  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]))
  const label = monthLabel(month)

  const sent: string[] = []
  const skippedNoEmail: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const entry of entries) {
    const employee = employeeById.get(entry.employee_id)
    if (!employee) continue

    if (!employee.email) {
      skippedNoEmail.push(employee.id)
      continue
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
    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer())

    const result = await sendPayslipEmail({
      to: employee.email,
      employeeName: employee.name,
      monthLabel: label,
      pdfBuffer,
      filename: `payslip-${employee.id}-${month}.pdf`,
    })

    if (result.ok) {
      sent.push(employee.id)
    } else {
      failed.push({ id: employee.id, error: result.error })
    }
  }

  const auditTimestamp = new Date()
    .toLocaleString("en-US", { timeZone: "Africa/Nairobi" })
  const formattedTimestamp = new Date(auditTimestamp).toISOString().replace("T", " ").substring(0, 19)

  await supabase.from("audit_logs").insert({
    id: `AUD-${Math.floor(100000 + Math.random() * 900000)}`,
    timestamp: formattedTimestamp,
    operator_user: guard.user.id,
    action: "SEND PAYSLIPS",
    document_ref: `payroll_runs/${month}`,
    details: `Emailed ${sent.length} payslip(s); ${skippedNoEmail.length} skipped (no email on file); ${failed.length} failed.`,
  })

  return NextResponse.json({ month, sent, skippedNoEmail, failed })
}
