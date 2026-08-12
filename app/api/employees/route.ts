import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import type { Employee } from "@/lib/seeds"

// Employee PII/salary data — finance_manager only. These routes use the
// service-role admin client below (bypasses RLS), so this check is the
// actual access-control gate, not just a UI nicety.
export async function GET() {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const supabase = createSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
  }

  const { data, error } = await supabase.from("employees").select("*").order("id")
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ employees: data ?? [] })
}

export async function POST(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const supabase = createSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
  }

  const body = (await request.json()) as Partial<Employee>
  if (!body.id || !body.name || !body.kra_pin) {
    return NextResponse.json({ error: "id, name, and kra_pin are required" }, { status: 400 })
  }

  const row = {
    id: body.id,
    name: body.name,
    national_id: body.national_id ?? `NID-${body.id}`,
    kra_pin: body.kra_pin,
    sha_pin: body.sha_pin ?? null,
    grade: body.grade ?? "Staff",
    cost_centre: body.cost_centre ?? "511",
    department: body.department ?? "Production",
    bank_name: body.bank_name ?? "N/A",
    bank_account_number: body.bank_account_number ?? "N/A",
    email: body.email ?? null,
    base_salary: body.base_salary ?? 0,
    bonus_commission: body.bonus_commission ?? 0,
    fringe_benefit: body.fringe_benefit ?? 0,
    transport_allowance: body.transport_allowance ?? 0,
    arrears: body.arrears ?? 0,
    ot_other: body.ot_other ?? 0,
    voluntary_pension: body.voluntary_pension ?? 0,
    advances: body.advances ?? 0,
    helb: body.helb ?? 0,
    company_loan: body.company_loan ?? 0,
    bank_loan: body.bank_loan ?? 0,
    sacco: body.sacco ?? 0,
    personal_relief_override: body.personal_relief_override ?? null,
    paye_band_flat_deduction: body.paye_band_flat_deduction ?? null,
    pension_rate_override: body.pension_rate_override ?? null,
    nssf_t2_override: body.nssf_t2_override ?? null,
    ahl_relief_override: body.ahl_relief_override ?? null,
  }

  const { data, error } = await supabase.from("employees").insert(row).select("*").single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ employee: data }, { status: 201 })
}
