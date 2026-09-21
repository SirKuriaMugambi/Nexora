import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import type { ParsedPayrollRow } from "@/lib/excel-ingest"
import { isVariablePayCategory, type VariablePayCategory } from "@/lib/variable-pay"
import { applyUploadToMonth, monthLockState } from "@/lib/variable-pay-store"

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// Writes a previewed variable-pay sheet into the month's ledger. The client
// sends back the rows it showed the finance manager in the preview — the
// same parsed values, so what was reviewed is exactly what is stored.
export async function POST(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const body = (await request.json().catch(() => ({}))) as {
    month?: string
    rows?: ParsedPayrollRow[]
    categories?: string[]
    sourceFile?: string | null
  }
  const month = body.month ?? ""
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 })
  const rows = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: "No rows to apply" }, { status: 400 })
  const categories = (body.categories ?? []).filter(isVariablePayCategory) as VariablePayCategory[]
  if (categories.length === 0) {
    return NextResponse.json({ error: "The sheet carried no variable-pay columns the system recognises." }, { status: 400 })
  }
  // Only categories the sheet actually carried may be written — a client
  // cannot smuggle in a column the finance manager never saw.
  const safeRows = rows.map((r) => ({
    ...r,
    variable: Object.fromEntries(
      Object.entries(r.variable ?? {}).filter(([k]) => categories.includes(k as VariablePayCategory)),
    ) as ParsedPayrollRow["variable"],
  }))

  const supabase = createSupabaseAdminClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })

  const lock = await monthLockState(supabase, month)
  if (lock.locked) {
    return NextResponse.json(
      { error: `The ${month} payroll run is ${lock.runStatus} — variable pay for that month can no longer be changed.` },
      { status: 409 },
    )
  }

  try {
    const summary = await applyUploadToMonth(supabase, month, safeRows, categories, {
      sourceFile: body.sourceFile?.trim() || null,
      userId: guard.user.id,
    })
    return NextResponse.json(summary)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
