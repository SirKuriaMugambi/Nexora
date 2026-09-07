import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireEmployeeSelf } from "@/lib/supabase"
import { buildP9Cards, generateIndividualP9PDF, type P9EntryRow } from "@/lib/p9-builder"

// Downloads exactly one employee's own P9 card for the requested year.
// Deliberately builds the input arrays scoped to only guard.employeeId from
// the start, rather than building all employees' cards and picking one out
// — there should never be a code path here that even momentarily holds
// another employee's data.
export async function GET(request: Request) {
  const guard = await requireEmployeeSelf()
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const year = new URL(request.url).searchParams.get("year")
  if (!year || !/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: "year query param is required, e.g. ?year=2026" }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: runs, error: runsError } = await admin
    .from("payroll_runs")
    .select("id, month")
    .gte("month", `${year}-01`)
    .lte("month", `${year}-12`)
    .in("status", ["Approved", "Posted"])

  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }
  if (!runs || runs.length === 0) {
    return NextResponse.json({ error: `No payroll data found for ${year}.` }, { status: 404 })
  }

  const monthByRunId = new Map(runs.map((r) => [r.id, r.month]))

  const { data: entries, error: entriesError } = await admin
    .from("payroll_register_entries")
    .select("payroll_run_id, basic_salary, fringe_benefit, gross_salary, nssf_t1, nssf_t2, defined_pension_ee, taxable_pay, gross_paye, personal_relief, nhif_relief, ahl_relief, net_paye")
    .eq("employee_id", guard.employeeId)
    .in("payroll_run_id", runs.map((r) => r.id))

  if (entriesError || !entries || entries.length === 0) {
    return NextResponse.json({ error: `No P9 data found for you in ${year}.` }, { status: 404 })
  }

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, name, kra_pin")
    .eq("id", guard.employeeId)
    .single()

  if (employeeError || !employee) {
    return NextResponse.json({ error: "Employee record not found." }, { status: 404 })
  }

  const p9Entries: P9EntryRow[] = entries.map((entry) => ({
    employee_id: guard.employeeId,
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

  const cards = buildP9Cards(year, [employee], p9Entries)
  if (cards.length === 0) {
    return NextResponse.json({ error: `No P9 data found for you in ${year}.` }, { status: 404 })
  }

  const pdfBlob = generateIndividualP9PDF(cards[0])
  const buffer = Buffer.from(await pdfBlob.arrayBuffer())

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="P9-${year}.pdf"`,
    },
  })
}
