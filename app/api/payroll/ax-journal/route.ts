import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { KENYA_PAYROLL_RULES_2024 } from "@/lib/payroll-rules-config"
import {
  axJournalToXlsx,
  axPeriodLabel,
  buildAxPayrollJournal,
  type AxJournalEmployeeInput,
} from "@/lib/ax-journal-builder"

// AX voucher numbers are Tony's own running sequence (his sample is
// SAL0000138) — we can't know the next one, so the default just encodes the
// period in the same 10-character shape and he types the real one in the UI.
function defaultVoucher(month: string): string {
  return `SAL${axPeriodLabel(month)}001`
}

// Last day of the payroll month, as a local date (no timezone shift when
// SheetJS serialises it).
function defaultPostingDate(month: string): Date {
  const [year, mm] = month.split("-").map(Number)
  return new Date(year, mm, 0)
}

function parseDateParam(value: string | null, fallback: Date): Date | null {
  if (!value) return fallback
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, m, d] = match.map(Number)
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

// Downloads the Approved run as a Dynamics AX journal upload (.xlsx) in the
// finance manager's exact file layout — see lib/ax-journal-builder.ts for
// the row-by-row mapping. Read-only: never touches the run's status.
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

  const voucher = (params.get("voucher") ?? "").trim() || defaultVoucher(month)
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(voucher)) {
    return NextResponse.json({ error: "voucher must be 1–20 letters, digits, - or _" }, { status: 400 })
  }
  const postingDate = parseDateParam(params.get("date"), defaultPostingDate(month))
  if (!postingDate) {
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
      { error: `Cannot generate an AX journal for a run with status "${run.status}" — it must be Approved first.` },
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

  const { data: employees, error: employeesError } = await supabase
    .from("employees")
    .select("id, department, cost_centre, cost_centre_allocation, grade")
    .in("id", entries.map((e) => e.employee_id))

  if (employeesError || !employees) {
    return NextResponse.json({ error: "Failed to load employee cost-centre data." }, { status: 500 })
  }
  const employeeById = new Map(employees.map((e) => [e.id, e]))

  const inputs: AxJournalEmployeeInput[] = entries.map((entry) => {
    const employee = employeeById.get(entry.employee_id)
    return {
      employee: {
        id: entry.employee_id,
        department: employee?.department ?? "Production",
        cost_centre: employee?.cost_centre ?? "511",
        cost_centre_allocation: employee?.cost_centre_allocation ?? null,
        grade: employee?.grade ?? null,
      },
      entry: {
        basic_salary: entry.basic_salary,
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
        nssf_t1: entry.nssf_t1,
        nssf_t2: entry.nssf_t2,
        shif: entry.shif,
        ahl: entry.ahl,
        defined_pension_ee: entry.defined_pension_ee,
        employer_pension: entry.employer_pension,
        net_paye: entry.net_paye,
        total_deductions: entry.total_deductions,
        net_pay: entry.net_pay,
      },
    }
  })

  const journal = buildAxPayrollJournal(month, inputs, {
    voucher,
    postingDate,
    nitaFlatPerEmployee: KENYA_PAYROLL_RULES_2024.nitaFlatPerEmployee,
  })

  // A journal that doesn't balance — or needs more than cents on the
  // rounding line — must never reach AX. Refuse loudly.
  if (!journal.isBalanced) {
    return NextResponse.json(
      {
        error:
          `AX journal does not balance (Dr ${journal.ledgerDebitTotal.toFixed(2)} vs Cr ${journal.ledgerCreditTotal.toFixed(2)}, `
          + `rounding ${journal.roundingAdjustment.toFixed(2)}) — not generated.`,
      },
      { status: 500 },
    )
  }

  return new NextResponse(new Uint8Array(axJournalToXlsx(journal)), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="chrysal-ax-payroll-journal-${month}.xlsx"`,
      "X-Journal-Debit-Total": journal.ledgerDebitTotal.toFixed(2),
      "X-Journal-Credit-Total": journal.ledgerCreditTotal.toFixed(2),
      "X-Journal-Bank-Total": journal.bankTotal.toFixed(2),
      "X-Journal-Rounding-Adjustment": journal.roundingAdjustment.toFixed(2),
    },
  })
}
