/**
 * Server-side persistence for the variable-pay ledger. Route handlers stay
 * thin; the rules about what gets stored, what gets cleared and when a month
 * is closed to edits live here where they can be tested.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ParsedPayrollRow } from "@/lib/excel-ingest"
import { planUploadForEmployee, type VariablePayCategory } from "@/lib/variable-pay"

// A month is editable while its run is absent, Draft or Rejected. Once it
// has been submitted for approval the numbers are what the approver saw.
export const LOCKED_RUN_STATUSES = ["Submitted", "Approved", "Posted"]

export async function monthLockState(supabase: SupabaseClient, month: string) {
  const { data } = await supabase.from("payroll_runs").select("status").eq("month", month).maybeSingle()
  const runStatus = (data?.status as string | undefined) ?? null
  return { runStatus, locked: runStatus !== null && LOCKED_RUN_STATUSES.includes(runStatus) }
}

export interface ApplyUploadSummary {
  month: string
  sourceFile: string | null
  /** Overrides written (value differed from Employee Master). */
  stored: number
  /** Overrides removed (sheet value equals Employee Master, so nothing varies). */
  cleared: number
  /** Employees in the sheet that exist in Employee Master. */
  matched: string[]
  /** Staff numbers in the sheet with no Employee Master record — not applied. */
  unmatched: string[]
  /** Where the sheet's Basic differs from Employee Master. Basic is standard pay, so it is reported, never applied. */
  basicDifferences: Array<{ employeeId: string; master: number; sheet: number }>
  /** Categories the sheet carried. */
  categories: VariablePayCategory[]
}

type MasterRow = Record<VariablePayCategory, number> & { id: string; base_salary: number }

/**
 * Writes a parsed sheet into the ledger for a month: for every matched
 * employee and every category the sheet carried, store the value when it
 * differs from Employee Master and clear any override when it matches.
 * Categories absent from the sheet are left exactly as they were.
 */
export async function applyUploadToMonth(
  supabase: SupabaseClient,
  month: string,
  rows: ParsedPayrollRow[],
  categories: VariablePayCategory[],
  opts: { sourceFile: string | null; userId: string },
): Promise<ApplyUploadSummary> {
  const ids = rows.map((r) => r.id)
  const { data: masters, error } = await supabase
    .from("employees")
    .select("id, base_salary, bonus_commission, arrears, ot_other, transport_allowance, fringe_benefit, voluntary_pension, advances, helb, company_loan, bank_loan, sacco")
    .in("id", ids)
  if (error) throw new Error(error.message)
  const masterById = new Map<string, MasterRow>()
  for (const m of masters ?? []) {
    const numeric = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, k === "id" ? v : Number(v ?? 0)]))
    masterById.set(String(m.id), numeric as unknown as MasterRow)
  }

  const upserts: Array<Record<string, unknown>> = []
  const clears: Array<{ employee_id: string; category: VariablePayCategory }> = []
  const matched: string[] = []
  const unmatched: string[] = []
  const basicDifferences: ApplyUploadSummary["basicDifferences"] = []
  const now = new Date().toISOString()

  for (const row of rows) {
    const master = masterById.get(row.id)
    if (!master) { unmatched.push(row.id); continue }
    matched.push(row.id)
    if (row.baseSalary > 0 && Math.abs(row.baseSalary - master.base_salary) >= 0.005) {
      basicDifferences.push({ employeeId: row.id, master: master.base_salary, sheet: row.baseSalary })
    }
    const plan = planUploadForEmployee(master, row.variable)
    for (const s of plan.store) {
      upserts.push({
        month, employee_id: row.id, category: s.category, amount: s.amount,
        source: "upload", source_file: opts.sourceFile, note: null, created_by: opts.userId, updated_at: now,
      })
    }
    for (const c of plan.clear) clears.push({ employee_id: row.id, category: c })
  }

  if (upserts.length > 0) {
    const { error: upErr } = await supabase.from("variable_pay").upsert(upserts, { onConflict: "month,employee_id,category" })
    if (upErr) throw new Error(upErr.message)
  }
  let cleared = 0
  for (const c of clears) {
    const { count, error: delErr } = await supabase
      .from("variable_pay")
      .delete({ count: "exact" })
      .match({ month, employee_id: c.employee_id, category: c.category })
    if (delErr) throw new Error(delErr.message)
    cleared += count ?? 0
  }

  return {
    month, sourceFile: opts.sourceFile, stored: upserts.length, cleared,
    matched, unmatched, basicDifferences, categories,
  }
}
