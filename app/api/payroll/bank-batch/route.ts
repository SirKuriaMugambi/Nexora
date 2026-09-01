import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { buildBankBatchCSV } from "@/lib/bank-batch-builder"

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
      { error: `Cannot generate a bank batch file for a run with status "${run.status}" — it must be Approved first.` },
      { status: 409 },
    )
  }

  const { data: entries, error: entriesError } = await supabase
    .from("payroll_register_entries")
    .select("employee_id, net_pay")
    .eq("payroll_run_id", run.id)

  if (entriesError || !entries || entries.length === 0) {
    return NextResponse.json({ error: `No payroll register entries found for month "${month}".` }, { status: 404 })
  }

  const employeeIds = entries.map((e) => e.employee_id)
  const { data: employees } = await supabase
    .from("employees")
    .select("id, name, bank_name, bank_account_number")
    .in("id", employeeIds)

  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]))

  const rows = entries.map((entry) => {
    const employee = employeeById.get(entry.employee_id)
    return {
      staffNo: entry.employee_id,
      name: employee?.name ?? entry.employee_id,
      bankName: employee?.bank_name ?? "N/A",
      bankAccountNumber: employee?.bank_account_number ?? "N/A",
      netSalary: entry.net_pay,
    }
  })

  // BOM so Excel decodes the file as UTF-8 (names/bank names with special
  // characters would otherwise render as mojibake).
  const csv = "﻿" + buildBankBatchCSV(rows, month)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8;",
      "Content-Disposition": `attachment; filename="chrysal-bank-batch-${month}.csv"`,
    },
  })
}
