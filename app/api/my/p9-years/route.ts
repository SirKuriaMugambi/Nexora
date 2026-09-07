import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireEmployeeSelf } from "@/lib/supabase"

// Lists the years this employee has at least one Approved/Posted run for —
// employeeId comes only from requireEmployeeSelf, never the request.
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
    return NextResponse.json({ years: [] })
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

  const years = Array.from(
    new Set(
      (entries ?? [])
        .map((e) => monthByRunId.get(e.payroll_run_id))
        .filter((m): m is string => Boolean(m))
        .map((m) => m.slice(0, 4)),
    ),
  ).sort((a, b) => b.localeCompare(a))

  return NextResponse.json({ years })
}
