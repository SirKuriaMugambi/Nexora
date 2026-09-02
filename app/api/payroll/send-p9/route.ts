import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { buildP9Cards, generateIndividualP9PDF, type P9EntryRow } from "@/lib/p9-builder"
import { sendP9Email, isEmailConfigured } from "@/lib/email"

// Emails each employee their own individual P9 card for the given year —
// mirrors app/api/payroll/send-payslips/route.ts. Employees with no email
// on file are skipped, not treated as an error.
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

  const body = (await request.json()) as { year?: string }
  const year = body.year
  if (!year || !/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: "year is required, e.g. { \"year\": \"2026\" }" }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: runs, error: runsError } = await supabase
    .from("payroll_runs")
    .select("id, month")
    .gte("month", `${year}-01`)
    .lte("month", `${year}-12`)
    .in("status", ["Approved", "Posted"])

  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }
  if (!runs || runs.length === 0) {
    return NextResponse.json(
      { error: `No Approved/Posted payroll runs found for ${year}.` },
      { status: 404 },
    )
  }

  const monthByRunId = new Map(runs.map((run) => [run.id, run.month]))

  const { data: entries, error: entriesError } = await supabase
    .from("payroll_register_entries")
    .select("payroll_run_id, employee_id, basic_salary, fringe_benefit, gross_salary, nssf_t1, nssf_t2, defined_pension_ee, taxable_pay, gross_paye, personal_relief, nhif_relief, ahl_relief, net_paye")
    .in("payroll_run_id", runs.map((run) => run.id))

  if (entriesError || !entries || entries.length === 0) {
    return NextResponse.json({ error: `No payroll register entries found for ${year}.` }, { status: 404 })
  }

  const { data: employees, error: employeesError } = await supabase
    .from("employees")
    .select("id, name, kra_pin, email")

  if (employeesError || !employees) {
    return NextResponse.json({ error: "Failed to load employee master data." }, { status: 500 })
  }

  const p9Entries: P9EntryRow[] = entries.map((entry) => ({
    employee_id: String(entry.employee_id),
    month: monthByRunId.get(entry.payroll_run_id) ?? "",
    basic_salary: Number(entry.basic_salary),
    fringe_benefit: Number(entry.fringe_benefit),
    gross_salary: Number(entry.gross_salary),
    nssf_t1: Number(entry.nssf_t1),
    nssf_t2: Number(entry.nssf_t2),
    defined_pension_ee: Number(entry.defined_pension_ee),
    taxable_pay: Number(entry.taxable_pay),
    gross_paye: Number(entry.gross_paye),
    personal_relief: Number(entry.personal_relief),
    nhif_relief: Number(entry.nhif_relief),
    ahl_relief: Number(entry.ahl_relief),
    net_paye: Number(entry.net_paye),
  }))

  const cards = buildP9Cards(year, employees, p9Entries)
  const employeeById = new Map(employees.map((e) => [e.id, e]))

  const sent: string[] = []
  const skippedNoEmail: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const card of cards) {
    const employee = employeeById.get(card.employeeId)
    if (!employee?.email) {
      skippedNoEmail.push(card.employeeId)
      continue
    }

    const pdfBlob = generateIndividualP9PDF(card)
    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer())

    const result = await sendP9Email({
      to: employee.email,
      employeeName: card.name,
      year,
      pdfBuffer,
      filename: `P9-${card.employeeId}-${year}.pdf`,
    })

    if (result.ok) {
      sent.push(card.employeeId)
    } else {
      failed.push({ id: card.employeeId, error: result.error })
    }
  }

  const auditTimestamp = new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" })
  const formattedTimestamp = new Date(auditTimestamp).toISOString().replace("T", " ").substring(0, 19)

  await supabase.from("audit_logs").insert({
    id: `AUD-${Math.floor(100000 + Math.random() * 900000)}`,
    timestamp: formattedTimestamp,
    operator_user: guard.user.id,
    action: "SEND P9 FORMS",
    document_ref: `p9/${year}`,
    details: `Emailed ${sent.length} P9 card(s) for ${year}; ${skippedNoEmail.length} skipped (no email on file); ${failed.length} failed.`,
  })

  return NextResponse.json({ year, sent, skippedNoEmail, failed })
}
