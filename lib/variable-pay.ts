/**
 * Variable pay — the parts of an employee's monthly pay that are not their
 * standard pay.
 *
 * Standard pay lives in Employee Master. Variable pay for a month lives in
 * the `variable_pay` table as one row per (employee, category) whose amount
 * differs from the standard value. Applying a month's rows to the master
 * record gives the figures the payroll run uses; comparing the two gives the
 * finance manager the "what changed for this person this month" view.
 *
 * Categories are exactly the payroll engine's variable input fields, so
 * anything stored here flows straight into the calculation. A sheet column
 * is matched to a category by the aliases below — add an alias, not a
 * category, when the finance manager renames a column.
 */
import type { Employee } from "@/lib/seeds"

export type VariablePayCategory =
  | "bonus_commission" | "arrears" | "ot_other" | "transport_allowance"
  | "fringe_benefit" | "voluntary_pension" | "advances" | "helb"
  | "company_loan" | "bank_loan" | "sacco"

export type VariablePayKind = "earning" | "non_cash" | "deduction"

export interface VariablePayCategoryDef {
  key: VariablePayCategory
  label: string
  kind: VariablePayKind
  /** Lower-cased substrings that identify this category's column in an uploaded sheet. */
  aliases: string[]
}

export const VARIABLE_PAY_CATEGORIES: VariablePayCategoryDef[] = [
  { key: "bonus_commission", label: "Bonus / Commission", kind: "earning", aliases: ["bonus/comm", "bonus", "commission"] },
  { key: "arrears", label: "Arrears", kind: "earning", aliases: ["arrears"] },
  { key: "ot_other", label: "Overtime / Others", kind: "earning", aliases: ["salary arrears/ot/others", "ot/others", "overtime", "others"] },
  { key: "transport_allowance", label: "Transport / House Allowance", kind: "earning", aliases: ["transport/hse allowance", "transport", "house allowance", "hse allowance"] },
  { key: "fringe_benefit", label: "Fringe Benefit (non-cash)", kind: "non_cash", aliases: ["fringe benefit", "fringe"] },
  { key: "voluntary_pension", label: "Voluntary Pension", kind: "deduction", aliases: ["voluntary pension"] },
  { key: "advances", label: "Advances", kind: "deduction", aliases: ["advances", "advance"] },
  { key: "helb", label: "HELB", kind: "deduction", aliases: ["helb"] },
  { key: "company_loan", label: "Company Loan", kind: "deduction", aliases: ["company loan"] },
  { key: "bank_loan", label: "Bank Loan", kind: "deduction", aliases: ["bank loan"] },
  { key: "sacco", label: "SACCO", kind: "deduction", aliases: ["sacco"] },
]

export const VARIABLE_PAY_CATEGORY_KEYS = VARIABLE_PAY_CATEGORIES.map((c) => c.key)

export const VARIABLE_PAY_LABELS: Record<VariablePayCategory, string> = Object.fromEntries(
  VARIABLE_PAY_CATEGORIES.map((c) => [c.key, c.label]),
) as Record<VariablePayCategory, string>

export function isVariablePayCategory(value: string): value is VariablePayCategory {
  return (VARIABLE_PAY_CATEGORY_KEYS as string[]).includes(value)
}

/**
 * Matches a sheet header cell to a category. "Arrears" must not claim the
 * "Salary Arrears/OT/Others" column, so the longest alias wins across all
 * categories rather than the first category that has any match.
 */
export function categoryForHeader(header: string): VariablePayCategory | null {
  const h = header.trim().toLowerCase()
  if (!h) return null
  let best: { key: VariablePayCategory; len: number } | null = null
  for (const cat of VARIABLE_PAY_CATEGORIES) {
    for (const alias of cat.aliases) {
      if (h.includes(alias) && (!best || alias.length > best.len)) best = { key: cat.key, len: alias.length }
    }
  }
  return best?.key ?? null
}

/** One stored override. */
export interface VariablePayRow {
  employee_id: string
  category: VariablePayCategory
  amount: number
  note?: string | null
  source?: "upload" | "manual"
}

/** The employee's standard pay record with a month's overrides applied. */
export function applyVariablePay<T extends Pick<Employee, VariablePayCategory>>(employee: T, rows: VariablePayRow[]): T {
  let out = employee
  for (const row of rows) {
    if (!isVariablePayCategory(row.category)) continue
    if (out === employee) out = { ...employee }
    out[row.category] = Number(row.amount) as T[VariablePayCategory]
  }
  return out
}

export interface VariablePayChange {
  category: VariablePayCategory
  label: string
  kind: VariablePayKind
  /** Employee Master value. */
  standard: number
  /** Value applied this month. */
  actual: number
  delta: number
  note?: string | null
  source?: "upload" | "manual"
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005

/**
 * What differs between the employee's standard pay and this month — one
 * entry per category whose stored amount is not the standard amount. An
 * empty list means "no changes: standard pay".
 */
export function variablePayChanges(
  employee: Pick<Employee, VariablePayCategory>,
  rows: VariablePayRow[],
): VariablePayChange[] {
  const changes: VariablePayChange[] = []
  for (const cat of VARIABLE_PAY_CATEGORIES) {
    const row = rows.find((r) => r.category === cat.key)
    if (!row) continue
    const standard = Number(employee[cat.key] ?? 0)
    const actual = Number(row.amount)
    if (near(standard, actual)) continue
    changes.push({
      category: cat.key, label: cat.label, kind: cat.kind,
      standard, actual, delta: +(actual - standard).toFixed(2),
      note: row.note ?? null, source: row.source,
    })
  }
  return changes
}

/** "+ Bonus / Commission 15,000 · Advances 10,000" — or the no-change phrase. */
export function describeChanges(changes: VariablePayChange[]): string {
  if (changes.length === 0) return "No changes — standard pay"
  const fmt = (n: number) => Math.abs(n).toLocaleString("en-KE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })
  return changes
    .map((c) => {
      const sign = c.kind === "deduction" ? (c.delta > 0 ? "−" : "+") : c.delta > 0 ? "+" : "−"
      return `${sign} ${c.label} ${fmt(c.delta)}`
    })
    .join(" · ")
}

/**
 * Given a month's sheet values for one employee, which rows to store and
 * which to clear: a value equal to the standard is not a change, so any
 * stored override for that category is removed; a different value is stored.
 * Categories the sheet did not carry are left untouched.
 */
export function planUploadForEmployee(
  employee: Pick<Employee, VariablePayCategory>,
  sheetValues: Partial<Record<VariablePayCategory, number>>,
): { store: Array<{ category: VariablePayCategory; amount: number }>; clear: VariablePayCategory[] } {
  const store: Array<{ category: VariablePayCategory; amount: number }> = []
  const clear: VariablePayCategory[] = []
  for (const cat of VARIABLE_PAY_CATEGORIES) {
    const v = sheetValues[cat.key]
    if (v === undefined) continue
    const standard = Number(employee[cat.key] ?? 0)
    if (near(standard, v)) clear.push(cat.key)
    else store.push({ category: cat.key, amount: +v.toFixed(2) })
  }
  return { store, clear }
}
