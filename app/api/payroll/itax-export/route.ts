import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { buildItaxExportCSV } from "@/lib/itax-export-builder"

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
      { error: `Cannot generate the iTax export for a run with status "${run.status}" — it must be Approved first.` },
      { status: 409 },
    )
  }

  const { data: entries, error: entriesError } = await supabase
    .from("payroll_register_entries")
    .select("employee_id, gross_salary, nssf_t1, nssf_t2, shif, ahl, taxable_pay, gross_paye, personal_relief, ahl_relief, net_paye")
    .eq("payroll_run_id", run.id)

  if (entriesError || !entries || entries.length === 0) {
    return NextResponse.json({ error: `No payroll register entries found for month "${month}".` }, { status: 404 })
  }

  const employeeIds = entries.map((e) => e.employee_id)
  const { data: employees } = await supabase
    .from("employees")
    .select("id, name, kra_pin")
    .in("id", employeeIds)

  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]))

  const rows = entries.map((entry) => {
    const employee = employeeById.get(entry.employee_id)
    return {
      kraPin: employee?.kra_pin ?? "",
      name: employee?.name ?? entry.employee_id,
      grossPay: entry.gross_salary,
      nssf: entry.nssf_t1 + entry.nssf_t2,
      shif: entry.shif,
      ahl: entry.ahl,
      taxablePay: entry.taxable_pay,
      taxCharged: entry.gross_paye,
      personalRelief: entry.personal_relief,
      ahlRelief: entry.ahl_relief,
      payeDue: entry.net_paye,
    }
  })

  // BOM so Excel decodes the file as UTF-8 (names with special characters
  // would otherwise render as mojibake).
  const csv = "﻿" + buildItaxExportCSV(rows, month)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8;",
      "Content-Disposition": `attachment; filename="chrysal-itax-export-${month}.csv"`,
    },
  })
}
