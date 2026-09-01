import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { buildP9Cards, generateP9PDF, type P9EntryRow } from "@/lib/p9-builder"

// Annual P9 tax deduction cards — one page per employee, built from every
// Approved/Posted payroll run in the requested year. Unlike the monthly
// exports this isn't gated on the CURRENT run's status: a P9 is issued for
// a year, so it needs at least one signed-off run in that year, not a
// particular state this month.
export async function GET(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const year = new URL(request.url).searchParams.get("year")
  if (!year || !/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: "year query param is required, e.g. ?year=2026" }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: runs, error: runsError } = await supabase
    .from("payroll_runs")
    .select("id, month, status")
    .gte("month", `${year}-01`)
    .lte("month", `${year}-12`)
    .in("status", ["Approved", "Posted"])

  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }
  if (!runs || runs.length === 0) {
    return NextResponse.json(
      { error: `No Approved/Posted payroll runs found for ${year} — P9 cards are built from signed-off runs.` },
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
    .select("id, name, kra_pin")

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
  if (cards.length === 0) {
    return NextResponse.json({ error: `No employees with payroll data found for ${year}.` }, { status: 404 })
  }

  const pdfBlob = generateP9PDF(cards)
  const buffer = Buffer.from(await pdfBlob.arrayBuffer())

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="chrysal-p9-forms-${year}.pdf"`,
    },
  })
}
