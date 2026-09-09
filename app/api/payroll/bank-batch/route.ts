import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { buildBankBatch, bankBatchToXlsx } from "@/lib/bank-batch-builder"

function parseDateParam(value: string | null, fallback: Date): Date | null {
  if (!value) return fallback
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const [, y, mo, d] = m.map(Number)
  const date = new Date(y, mo - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

// Produces the salary payment file in Chrysal's own bank layout — see
// lib/bank-batch-builder.ts for the record structure, taken from the finance
// manager's real November 2024 upload.
export async function GET(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const params = new URL(request.url).searchParams
  const month = params.get("month")
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month query param is required, e.g. ?month=2026-08" }, { status: 400 })
  }

  // Defaults to the last day of the pay month; the bank shows this as the
  // value date, so it is overridable.
  const [year, mm] = month.split("-").map(Number)
  const paymentDate = parseDateParam(params.get("date"), new Date(year, mm, 0))
  if (!paymentDate) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
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

  const { data: employees } = await supabase
    .from("employees")
    .select("id, name, bank_account_number, bank_branch_code, emp_code")
    .in("id", entries.map((e) => e.employee_id))

  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]))

  const rows = entries
    .map((entry) => {
      const employee = employeeById.get(entry.employee_id)
      return {
        staffNo: entry.employee_id,
        name: employee?.name ?? entry.employee_id,
        bankAccountNumber: employee?.bank_account_number ?? "",
        bankBranchCode: employee?.bank_branch_code ?? "",
        empCode: employee?.emp_code ?? "",
        netSalary: Number(entry.net_pay),
      }
    })
    .sort((a, b) => a.staffNo.localeCompare(b.staffNo))

  const batch = buildBankBatch(rows, month, paymentDate)

  // Every employee incomplete is an employee who does not get paid, so this
  // refuses rather than quietly handing over a short file.
  if (batch.skipped.length > 0) {
    return NextResponse.json(
      {
        error:
          `${batch.skipped.length} employee(s) are missing bank details, so the file would leave them unpaid. ` +
          `Fix them in Employee Master first: ` +
          batch.skipped.map((s) => `${s.staffNo} (${s.reason})`).join("; "),
      },
      { status: 409 },
    )
  }

  return new NextResponse(new Uint8Array(bankBatchToXlsx(batch)), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="chrysal-bank-batch-${month}.xlsx"`,
      "X-Bank-Batch-Records": String(batch.recordCount),
      "X-Bank-Batch-Total": batch.total.toFixed(2),
    },
  })
}
