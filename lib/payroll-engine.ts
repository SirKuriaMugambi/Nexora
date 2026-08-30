/**
 * Chrysal FinOps AI — Kenyan Statutory Payroll Engine
 *
 * Source of truth: reference-data/CA- AI Payroll automation project.xlsx
 *   Sheet "AI-Automation-workings" (Rows 25–51, 56–60, 62)
 *   Cross-verified line-by-line against real employee figures on 2026-08-02.
 *
 * KRA PAYE bands (2024–2026, monthly):
 *   Band 1 : ≤ 24,000                → 10%  (max KES 2,400)
 *   Band 2 : 24,001 – 32,333         → 25%  (max KES 2,083.25)
 *   Band 3 : 32,334 – 500,000        → 30%  (max KES 140,299.80)
 *   Band 4 : 500,001 – 800,000       → 32.5% (max KES 97,499.675)
 *   Band 5 : > 800,000               → 35%
 *
 * Personal Relief  : KES 2,400 / month (statutory default). Two employees
 *                    on the parent-company/expatriate arrangement carry a
 *                    different relief figure in Tony's sheet — these are
 *                    NOT normalized to the standard 2,400; pass their real
 *                    relief value via `personal_relief_override`.
 * AHL Relief       : 15% of the AHL (Housing Levy) contribution, applied as
 *                    a tax credit against Gross PAYE.
 * NSSF Tier I/II   : KES 420 / KES 1,740 per month — kept FLAT, exactly as
 *                    they appear in Tony's 2024 source sheet, per instruction
 *                    to stay accurate to the original workbook rather than
 *                    recalculate against newer earnings-limit bands.
 * SHIF             : 2.75% of BASIC SALARY (verified — NOT gross salary).
 * AHL (Housing)    : 1.5% of BASIC SALARY (verified — NOT gross salary).
 * Pension EE       : 5% of BASIC SALARY (verified — NOT gross salary),
 *                    capped at KES 20,000/month.
 * Pension ER       : 10% of BASIC SALARY (employer match, same basis).
 *
 * Voluntary pension contributions do NOT reduce taxable pay in the source
 * sheet — verified against an employee who has a voluntary contribution
 * and whose Taxable Pay matches Gross − NSSF − Defined Pension only.
 *
 * PAYE band boundaries are computed from (previous ceiling + 1), not from
 * the previous ceiling itself — e.g. Tony's 25% band is literally
 * `32,333 − 24,001`, not `32,333 − 24,000`. This is consistent across every
 * band in the source sheet (confirmed against the flat totals KES 2,400 /
 * 2,083 / 140,299.80 / 97,499.675 for bands 1–4), so it's replicated exactly
 * rather than "corrected" to the more conventional boundary — using the
 * conventional boundary understates PAYE by a few shillings per employee
 * relative to Tony's numbers.
 *
 * Pension contributions above the KES 20,000 statutory cap are NOT dropped:
 * the excess still leaves the employee's pay, so it's redirected into the
 * voluntary-pension deduction bucket (verified against an employee whose 5%
 * contribution exceeds the cap — Tony's sheet folds the excess into the
 * same cell as the voluntary contribution). It does not reduce taxable pay.
 *
 * A full 46-employee audit against Tony's actual computed figures (not just
 * spot-checks) surfaced three further per-employee patterns in his sheet,
 * all confirmed by reading his real formulas cell-by-cell, not inferred:
 *
 * - Several employees (7 of 46) have their PAYE bands computed on
 *   (Gross − a flat amount) instead of the standard (Gross − actual NSSF −
 *   capped pension). The flat amount varies by employee (20,000 / 45,000 /
 *   0 — i.e. no deduction at all) — pass the exact figure via
 *   `paye_band_flat_deduction`. Their *reported* Taxable Pay still uses the
 *   standard formula; only the band base differs. Leave unset for everyone
 *   else — do not apply generally.
 * - 12 of 46 employees have 0% employee pension in Tony's sheet, not the
 *   standard 5% — pass `pension_rate_override: 0` for those specific
 *   employees (verified via each one's row-59 formula literally reading
 *   `*0%`, not a missing/blank cell).
 * - 5 of the lowest-paid employees have a non-flat NSSF Tier II figure
 *   (Tony's formula for them is `(gross − 600 − 7000) × 6%`, not the flat
 *   1,740 everyone else uses) — pass the exact figure via
 *   `nssf_t2_override`.
 *
 * All rates/bands below live in lib/payroll-rules-config.ts — update the
 * KRA bands, NSSF, SHIF, AHL, pension, or NITA figures there, not here.
 */

import { KENYA_PAYROLL_RULES_2024 } from "@/lib/payroll-rules-config"

const RULES = KENYA_PAYROLL_RULES_2024

export interface PayrollInputs {
  base_salary: number
  bonus_commission: number
  fringe_benefit: number        // FBT / loan benefit non-cash
  transport_allowance: number
  arrears: number
  ot_other: number
  voluntary_pension: number     // EE voluntary (on top of mandatory 5%)
  advances: number
  helb: number
  company_loan: number
  bank_loan: number
  sacco: number
  // Optional override for employees whose relief doesn't follow the
  // standard KES 2,400 default (e.g. parent-company/expatriate staff on
  // a different tax/relief arrangement in Tony's sheet). Leave undefined
  // for standard employees.
  personal_relief_override?: number
  // Per-employee statutory overrides traced from Tony's actual formulas —
  // see the file header comment for exactly which employees need these and
  // why. Leave all undefined for standard employees.
  paye_band_flat_deduction?: number
  pension_rate_override?: number
  nssf_t2_override?: number
  ahl_relief_override?: number
}

export interface PayrollResult {
  gross_salary: number

  // Statutory
  nssf_t1: number
  nssf_t2: number
  shif: number
  ahl: number
  defined_pension_ee: number
  defined_pension_er: number

  // Tax
  taxable_pay: number
  gross_paye: number
  personal_relief: number
  nhif_relief: number
  ahl_relief: number
  net_paye: number

  // Post-tax
  allowances: number
  deductions: number
  nssf: number
  nhif: number
  paye: number
  net_salary: number
  total_deductions: number
}

// ── PAYE graduated slab calculator ──────────────────────────────────────────
// Bands are cumulative upper bounds (e.g. 24000, then 32333, then 500000...).
// Each band's slice is measured from (previous ceiling + 1) — see the file
// header comment for why this isn't the more conventional previous-ceiling
// boundary.
function computeGrossPAYE(taxableMonthlyIncome: number): number {
  if (taxableMonthlyIncome <= 0) return 0

  let tax = 0
  let previousCeiling = 0

  for (const band of RULES.payeBands) {
    const bandCeiling = band.upTo ?? Infinity
    const bandFloor = previousCeiling === 0 ? 0 : previousCeiling + 1
    const upperForThisBand = Math.min(taxableMonthlyIncome, bandCeiling)
    const sliceInThisBand = Math.max(upperForThisBand - bandFloor, 0)

    tax += sliceInThisBand * band.rate
    previousCeiling = bandCeiling

    if (taxableMonthlyIncome <= bandCeiling) break
  }

  return tax
}

// ── Main compute function ────────────────────────────────────────────────────
export function computePayroll(inputs: PayrollInputs): PayrollResult {
  const {
    base_salary, bonus_commission, fringe_benefit, transport_allowance,
    arrears, ot_other, voluntary_pension,
    advances, helb, company_loan, bank_loan, sacco,
    personal_relief_override, paye_band_flat_deduction,
    pension_rate_override, nssf_t2_override, ahl_relief_override,
  } = inputs

  // 1. Gross Salary — sum of all allowances, still on gross (unchanged)
  const gross_salary = base_salary + bonus_commission + fringe_benefit
    + transport_allowance + arrears + ot_other

  // All intermediate math below stays at full floating-point precision —
  // matching how Tony's own workbook computes (Excel never rounds between
  // formula steps, only in how a cell displays). Rounding to 2dp happens
  // exactly once, when each field is placed into the returned result — doing
  // it earlier and feeding the rounded value into the next formula is what
  // caused cent-level drift from the source sheet during verification.

  // 2. Statutory deductions (pre-tax) — SHIF, AHL and Pension EE/ER are all
  //    computed against RULES.statutoryBasis ("basic" by default, matching
  //    Tony's sheet exactly; "gross" is the legally-standard definition,
  //    available as a one-line config flip once Tony approves the switch).
  //    NSSF stays FLAT per Tony's 2024 sheet, not recalculated per employee.
  const statutory_base = RULES.statutoryBasis === "gross" ? gross_salary : base_salary
  const nssf_t1_raw = RULES.nssfTier1Flat
  const nssf_t2_raw = nssf_t2_override ?? RULES.nssfTier2Flat
  const shif_raw = statutory_base * RULES.shifRate
  const ahl_raw = statutory_base * RULES.ahlRate
  const pension_rate = pension_rate_override ?? RULES.pensionEmployeeRate
  const raw_pension_ee = statutory_base * pension_rate
  const defined_pension_ee_raw = Math.min(raw_pension_ee, RULES.pensionEmployeeCap)
  const defined_pension_er_raw = statutory_base * RULES.pensionEmployerRate
  // Contributions above the statutory cap still leave the employee's pay —
  // they're just not tax-deductible — so the excess is folded into the
  // voluntary-pension deduction bucket, not dropped. See file header.
  const pension_excess_over_cap = Math.max(raw_pension_ee - RULES.pensionEmployeeCap, 0)
  const total_voluntary_raw = voluntary_pension + pension_excess_over_cap

  // 3. Taxable pay = Gross − NSSF − Defined Pension EE only.
  //    Voluntary pension does NOT reduce taxable pay — verified against
  //    an employee with a voluntary contribution whose taxable pay matched
  //    exactly without subtracting it.
  const taxable_pay_raw = gross_salary - defined_pension_ee_raw - nssf_t1_raw - nssf_t2_raw

  // 4. Gross PAYE from slabs. Confirmed-exception employees compute their
  //    band tax on (Gross − a flat amount) instead of the standard taxable
  //    pay — see file header. paye_band_flat_deduction of 0 is a valid,
  //    meaningful value (some employees' bands use raw gross, no deduction
  //    at all), so this checks for undefined specifically, not falsiness.
  const paye_band_base = paye_band_flat_deduction !== undefined
    ? gross_salary - paye_band_flat_deduction
    : taxable_pay_raw
  const gross_paye_raw = computeGrossPAYE(paye_band_base)

  // 5. Reliefs — use the employee's override if one is set (parent-company/
  //    expatriate staff on a different relief arrangement), otherwise the
  //    standard KES 2,400/month.
  const personal_relief_raw = personal_relief_override ?? RULES.personalReliefStandard
  const nhif_relief_raw = RULES.nhifReliefRate
  const ahl_relief_raw = ahl_relief_override ?? Math.min(ahl_raw * RULES.ahlReliefRate, ahl_raw)

  // 6. Net PAYE
  const net_paye_raw = Math.max(
    gross_paye_raw - personal_relief_raw - nhif_relief_raw - ahl_relief_raw,
    0
  )

  // 7. Total deductions — Net Pay must still subtract the non-cash fringe
  //    benefit separately (see step 8): it's taxed as part of gross but
  //    never actually paid out in cash.
  const total_deductions_raw =
    net_paye_raw + nssf_t1_raw + nssf_t2_raw + shif_raw + ahl_raw
    + defined_pension_ee_raw + total_voluntary_raw
    + advances + helb + company_loan + bank_loan + sacco

  // 8. Net salary — subtract non-cash fringe benefit (it's taxed but not
  //    paid in cash) in addition to total deductions. Verified exact
  //    against multiple employees with and without fringe benefits.
  const net_salary_raw = gross_salary - fringe_benefit - total_deductions_raw

  // 9. Legacy aliases
  const allowances_raw = fringe_benefit + transport_allowance + bonus_commission
  const nssf_raw = nssf_t1_raw + nssf_t2_raw

  const round2 = (n: number) => +n.toFixed(2)

  return {
    gross_salary: round2(gross_salary),
    nssf_t1: round2(nssf_t1_raw), nssf_t2: round2(nssf_t2_raw), shif: round2(shif_raw), ahl: round2(ahl_raw),
    defined_pension_ee: round2(defined_pension_ee_raw), defined_pension_er: round2(defined_pension_er_raw),
    taxable_pay: round2(taxable_pay_raw), gross_paye: round2(gross_paye_raw),
    personal_relief: round2(personal_relief_raw), nhif_relief: round2(nhif_relief_raw),
    ahl_relief: round2(ahl_relief_raw), net_paye: round2(net_paye_raw),
    allowances: round2(allowances_raw), deductions: round2(total_deductions_raw),
    nssf: round2(nssf_raw), nhif: round2(shif_raw), paye: round2(net_paye_raw),
    net_salary: round2(net_salary_raw),
    total_deductions: round2(total_deductions_raw),
  }
}

// ── GL Posting Summary builder (matching Excel rows 174-183 structure) ───────
export interface GLPostingSummary {
  gross_salaries: number      // Row 174 - Basic + Benefits
  ahl_total: number           // Row 175
  nssf_total: number          // Row 176 (EE + ER)
  nita_total: number          // Row 177 (fixed KES 50/employee)
  pension_total: number       // Row 178 (EE only)
  subtotal: number            // Row 180
  fbt_other: number           // Row 181 (FBT + non-cash benefits total)
  total_gross_payroll: number // Row 182
  net_salaries: number        // Row 183
}

export interface CostCentreBreakdown {
  code: string
  name: string
  gross: number
  net: number
  paye: number
  pension_er: number
  nssf: number
  ahl: number
  shif: number
  headcount: number
}

export type EmployeeSummary = {
  id: string; name: string; kra_pin: string; cost_centre: string;
  gross_salary: number; net_paye: number; nssf_t1: number; nssf_t2: number;
  shif: number; ahl: number; defined_pension_ee: number; defined_pension_er: number;
  helb: number; company_loan: number; bank_loan: number; sacco: number; advances: number;
  net_salary: number;
}

const CC_NAMES: Record<string, string> = {
  "121": "Finance",
  "204": "Technical (TC)",
  "205": "General Manager",
  "206": "Technical Assistants (TA)",
  "511": "Production",
  "512": "Production-OH",
}

export function buildGLPosting(employees: EmployeeSummary[]): GLPostingSummary {
  const gross_salaries = +employees.reduce((s, e) => s + e.gross_salary, 0).toFixed(2)
  const ahl_total = +employees.reduce((s, e) => s + e.ahl, 0).toFixed(2)
  const nssf_ee = +employees.reduce((s, e) => s + e.nssf_t1 + e.nssf_t2, 0).toFixed(2)
  const nssf_er = +employees.reduce((s, e) => s + (e.nssf_t1 + e.nssf_t2), 0).toFixed(2)
  const nssf_total = +(nssf_ee + nssf_er).toFixed(2)
  const nita_total = +(employees.length * RULES.nitaFlatPerEmployee).toFixed(2)
  const pension_total = +employees.reduce((s, e) => s + e.defined_pension_ee, 0).toFixed(2)
  const subtotal = +(gross_salaries + ahl_total + nssf_total + nita_total + pension_total).toFixed(2)
  const fbt_other = 0  // Can be extended for FBT separately
  const total_gross_payroll = +(subtotal + fbt_other).toFixed(2)
  const net_salaries = +employees.reduce((s, e) => s + e.net_salary, 0).toFixed(2)

  return {
    gross_salaries, ahl_total, nssf_total, nita_total,
    pension_total, subtotal, fbt_other,
    total_gross_payroll, net_salaries,
  }
}

export function buildCostCentreBreakdown(employees: EmployeeSummary[]): CostCentreBreakdown[] {
  const map = new Map<string, CostCentreBreakdown>()

  for (const emp of employees) {
    const cc = emp.cost_centre
    if (!map.has(cc)) {
      map.set(cc, {
        code: cc,
        name: CC_NAMES[cc] ?? cc,
        gross: 0, net: 0, paye: 0,
        pension_er: 0, nssf: 0, ahl: 0, shif: 0,
        headcount: 0,
      })
    }
    const row = map.get(cc)!
    row.gross += emp.gross_salary
    row.net += emp.net_salary
    row.paye += emp.net_paye
    row.pension_er += emp.defined_pension_er
    row.nssf += emp.nssf_t1 + emp.nssf_t2
    row.ahl += emp.ahl
    row.shif += emp.shif
    row.headcount += 1
  }

  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code))
}

export interface PayrollVarianceReport {
  total_variance: number
  favorable_variance: number
  unfavorable_variance: number
  by_cost_centre: Array<{
    code: string
    name: string
    gross: number
    net: number
    variance: number
    payroll_cost: number
  }>
}

export function buildPayrollVarianceReport(employees: EmployeeSummary[]): PayrollVarianceReport {
  const total_variance = +employees.reduce((sum, emp) => sum + (emp.gross_salary - emp.net_salary), 0).toFixed(2)
  const favorable_variance = Math.max(total_variance, 0)
  const unfavorable_variance = Math.max(-total_variance, 0)

  const ccMap = new Map<string, { code: string; name: string; gross: number; net: number; variance: number; payroll_cost: number }>()

  for (const emp of employees) {
    const cc = emp.cost_centre
    const row = ccMap.get(cc) ?? {
      code: cc,
      name: CC_NAMES[cc] ?? cc,
      gross: 0,
      net: 0,
      variance: 0,
      payroll_cost: 0,
    }

    row.gross += emp.gross_salary
    row.net += emp.net_salary
    row.variance += emp.gross_salary - emp.net_salary
    row.payroll_cost += emp.net_salary
    ccMap.set(cc, row)
  }

  return {
    total_variance,
    favorable_variance,
    unfavorable_variance,
    by_cost_centre: Array.from(ccMap.values()).sort((a, b) => a.code.localeCompare(b.code)),
  }
}

// ── CSV export helpers ────────────────────────────────────────────────────────
// Every column the master register needs — matches the full Employee shape
// the payroll page already holds (from GET /api/payroll), so the export can
// mirror Tony's Excel register column-for-column with no blanks.
export interface MasterRegisterRow {
  id: string; name: string; kra_pin: string
  base_salary: number; bonus_commission: number; fringe_benefit: number
  transport_allowance: number; arrears: number; ot_other: number
  gross_salary: number; voluntary_pension: number; defined_pension_ee: number
  nssf_t1: number; nssf_t2: number; shif: number
  taxable_pay: number; gross_paye: number; ahl: number
  advances: number; helb: number; company_loan: number; bank_loan: number; sacco: number
  personal_relief: number; nhif_relief: number; ahl_relief: number
  net_paye: number; deductions: number; net_salary: number; defined_pension_er: number
}

export function buildMasterRegisterCSV(employees: MasterRegisterRow[]): string {
  const headers = [
    "Staff No","Name","KRA PIN","Basic Salary","Bonus/Comm","Fringe Benefit",
    "Transport/Hse Allowance","Arrears","OT/Others","Gross Salary",
    "Voluntary Pension","Defined Pension EE 5%","NSSF T1","NSSF T2","SHIF",
    "Taxable Pay","Gross PAYE","House Levy (AHL)","Advances","HELB",
    "Company Loan","Bank Loan","SACCO","Personal Relief","NHIF Relief",
    "AHL Relief","Net PAYE","Total Deductions","Net Pay","Employer Pension",
  ]
  const n = (v: number | null | undefined) => (v ?? 0).toFixed(2)
  const rows = employees.map(e => [
    e.id, e.name, e.kra_pin,
    n(e.base_salary), n(e.bonus_commission), n(e.fringe_benefit),
    n(e.transport_allowance), n(e.arrears), n(e.ot_other), n(e.gross_salary),
    n(e.voluntary_pension), n(e.defined_pension_ee),
    n(e.nssf_t1), n(e.nssf_t2), n(e.shif),
    n(e.taxable_pay), n(e.gross_paye), n(e.ahl),
    n(e.advances), n(e.helb), n(e.company_loan), n(e.bank_loan), n(e.sacco),
    n(e.personal_relief), n(e.nhif_relief), n(e.ahl_relief),
    n(e.net_paye), n(e.deductions), n(e.net_salary), n(e.defined_pension_er),
  ])
  // Quote every cell — names like "KURIA, CALEB" contain commas.
  return [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n")
}

export function buildGLPostingCSV(gl: GLPostingSummary, month: string): string {
  const lines = [
    ["Chrysal Africa Ltd — AX GL Posting Summary", month],
    [""],
    ["Description", "Amount (KES)"],
    ["Gross Salaries (Basic + Benefits)", gl.gross_salaries.toFixed(2)],
    ["AHL (Housing Levy)", gl.ahl_total.toFixed(2)],
    ["NSSF (EE + ER)", gl.nssf_total.toFixed(2)],
    ["NITA", gl.nita_total.toFixed(2)],
    ["Pension (Employee 5%)", gl.pension_total.toFixed(2)],
    ["Subtotal", gl.subtotal.toFixed(2)],
    ["FBT / Other Benefits", gl.fbt_other.toFixed(2)],
    ["Total Gross Payroll", gl.total_gross_payroll.toFixed(2)],
    ["Net Salaries (Cash to Staff)", gl.net_salaries.toFixed(2)],
  ]
  return lines.map(r => r.join(",")).join("\n")
}