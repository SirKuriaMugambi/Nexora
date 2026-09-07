import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireEmployeeSelf } from "@/lib/supabase"

// Lists the months this employee has an Approved/Posted payslip for — the
// employeeId comes ONLY from requireEmployeeSelf's server-side lookup
// (never from the request), so this can only ever list the caller's own
// months. Two-step query (runs, then entries scoped to those run ids)
// rather than a single embedded-join filter, matching the pattern already
// used everywhere else in this codebase (e.g. app/api/payroll/send-payslips)
// rather than relying on PostgREST embedded-filter syntax untested here.
export async function GET() {
  const guard = await requireEmployeeSelf()
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: runs, error: runsError } = await admin
    .from("payroll_runs")
    .select("id, month")
    .in("status", ["Approved", "Posted"])

  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 })
  }
  if (!runs || runs.length === 0) {
    return NextResponse.json({ months: [] })
  }

  const monthByRunId = new Map(runs.map((r) => [r.id, r.month]))

  const { data: entries, error: entriesError } = await admin
    .from("payroll_register_entries")
    .select("payroll_run_id")
    .eq("employee_id", guard.employeeId)
    .in("payroll_run_id", runs.map((r) => r.id))

  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 })
  }

  const months = Array.from(
    new Set((entries ?? []).map((e) => monthByRunId.get(e.payroll_run_id)).filter((m): m is string => Boolean(m))),
  ).sort((a, b) => b.localeCompare(a))

  return NextResponse.json({ months })
}
