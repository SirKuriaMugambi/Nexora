import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { isVariablePayCategory, type VariablePayRow } from "@/lib/variable-pay"
import { monthLockState } from "@/lib/variable-pay-store"

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Stored rows for a month, plus whether the month's run still allows edits. */
export interface VariablePayMonth {
  month: string
  rows: Array<VariablePayRow & { note: string | null; source: "upload" | "manual"; source_file: string | null; updated_at: string }>
  runStatus: string | null
  /** True once the month's run is Submitted, Approved or Posted — the figures are spoken for. */
  locked: boolean
}

export async function GET(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const month = new URL(request.url).searchParams.get("month") ?? ""
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month query param is required, e.g. ?month=2026-08" }, { status: 400 })
  }
  const supabase = createSupabaseAdminClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })

  const { data, error } = await supabase
    .from("variable_pay")
    .select("employee_id, category, amount, note, source, source_file, updated_at")
    .eq("month", month)
    .order("employee_id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const lock = await monthLockState(supabase, month)
  const payload: VariablePayMonth = {
    month,
    rows: (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as VariablePayMonth["rows"],
    ...lock,
  }
  return NextResponse.json(payload)
}

// Set or clear ONE override by hand. amount null = back to the standard value.
export async function PUT(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const body = (await request.json().catch(() => ({}))) as {
    month?: string; employee_id?: string; category?: string; amount?: number | null; note?: string | null
  }
  const { month = "", employee_id = "", category = "" } = body
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 })
  if (!employee_id.trim()) return NextResponse.json({ error: "employee_id is required" }, { status: 400 })
  if (!isVariablePayCategory(category)) return NextResponse.json({ error: `Unknown variable pay category "${category}"` }, { status: 400 })
  const clearing = body.amount === null || body.amount === undefined
  const amount = clearing ? 0 : Number(body.amount)
  if (!clearing && !Number.isFinite(amount)) return NextResponse.json({ error: "amount must be a number" }, { status: 400 })

  const supabase = createSupabaseAdminClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })

  const lock = await monthLockState(supabase, month)
  if (lock.locked) {
    return NextResponse.json(
      { error: `The ${month} payroll run is ${lock.runStatus} — variable pay for that month can no longer be changed.` },
      { status: 409 },
    )
  }

  if (clearing) {
    const { error } = await supabase.from("variable_pay").delete().match({ month, employee_id, category })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ cleared: true })
  }

  const { data, error } = await supabase
    .from("variable_pay")
    .upsert(
      {
        month, employee_id, category, amount: +amount.toFixed(2),
        note: body.note?.trim() || null, source: "manual", source_file: null,
        created_by: guard.user.id, updated_at: new Date().toISOString(),
      },
      { onConflict: "month,employee_id,category" },
    )
    .select("employee_id, category, amount, note, source, source_file, updated_at")
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ row: { ...data, amount: Number(data.amount) } })
}
