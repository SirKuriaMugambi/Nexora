/**
 * Kenyan statutory payroll rates/bands, in one place so a rate change (new
 * KRA PAYE bands, an NSSF step-up, a NITA increase, etc.) is a config edit,
 * not a hunt through calculation logic.
 *
 * Rules are EFFECTIVE-DATED. Each card carries `effectiveFrom` (a "YYYY-MM"
 * pay month) and `rulesForMonth()` picks the latest card in force for the
 * month being run. The engine takes the chosen card as an argument — it has
 * no default, so a caller can never silently run one year's pay through
 * another year's rules (which is exactly what happened before this existed:
 * a single 2024 constant, applied to every month).
 *
 * Baseline card (2024): traced cell-for-cell from the finance manager's
 * November 2024 workbook — reference-data/CA- AI Payroll automation
 * project.xlsx, sheet "Integrating with AX cost center". See
 * lib/payroll-engine.ts's header for the verification notes.
 *
 * Later cards: populated from the statutory changes published since, and
 * flagged inline where a figure still needs confirming against the finance
 * manager's own sheet for that month before sign-off.
 */

export interface PayeBand {
  /** Upper bound of this band's taxable income slice, in KES. `null` = no upper bound (top band). */
  upTo: number | null
  rate: number
}

export interface KenyaPayrollRules {
  /** Human label for logs, the UI and the comparison workbook. */
  label: string
  /** First pay month ("YYYY-MM") this card applies to, inclusive. */
  effectiveFrom: string

  /**
   * Which pay figure SHIF/AHL/pension are computed against. The finance
   * manager's sheet uses "basic" (verified cent-for-cent) — kept so the
   * system matches his numbers exactly for sign-off. The legally-standard
   * definition of SHIF/AHL is "gross salary"; flip this to "gross" only once
   * he has approved and the company is ready to correct its own methodology.
   * A single global switch, not per-employee — everyone moves together.
   */
  statutoryBasis: "basic" | "gross"

  /**
   * NSSF (Act 2013) tiers. Tier I = rate × earnings up to the lower limit;
   * Tier II = rate × earnings between the lower and upper limits. Both are
   * matched by the employer. `nssfBasis` is the earnings figure the tiers
   * are measured against — the finance manager's low-earner formula uses
   * gross. A per-employee `nssf_t2_override` still wins when set.
   */
  nssfRate: number
  nssfLowerLimit: number
  nssfUpperLimit: number
  nssfBasis: "basic" | "gross"

  /** SHIF contribution rate on the statutory basis. */
  shifRate: number
  /** Whether SHIF reduces taxable pay (true from the Tax Laws (Amendment) Act 2024). */
  shifDeductible: boolean

  /** Affordable Housing Levy rate on the statutory basis (employee share; employer matches). */
  ahlRate: number
  /** Whether AHL reduces taxable pay (true from the Tax Laws (Amendment) Act 2024). */
  ahlDeductible: boolean
  /** Tax credit as a share of the AHL contribution. 15% until the 2024 amendment replaced it with deductibility. */
  ahlReliefRate: number

  /** Employee defined-contribution pension rate on the statutory basis, and the monthly tax-deductible cap. */
  pensionEmployeeRate: number
  pensionEmployeeCap: number
  /** Employer contribution rate on the same basis. Not paid for an employee outside the scheme (employee rate override of 0). */
  pensionEmployerRate: number

  /** Standard monthly personal relief. Per-employee `personal_relief_override` takes precedence. */
  personalReliefStandard: number
  /** NHIF/SHIF relief — a flat amount. 0 on every card so far. */
  nhifReliefRate: number

  /** NITA training levy — flat per employee per month, employer-borne. */
  nitaFlatPerEmployee: number

  /** KRA PAYE graduated monthly tax bands, applied cumulatively. */
  payeBands: PayeBand[]
}

/** Finance Act 2023 bands — unchanged through every card below. */
const PAYE_BANDS_FROM_JULY_2023: PayeBand[] = [
  { upTo: 24000, rate: 0.10 },
  { upTo: 32333, rate: 0.25 },
  { upTo: 500000, rate: 0.30 },
  { upTo: 800000, rate: 0.325 },
  { upTo: null, rate: 0.35 },
]

/**
 * BASELINE — the finance manager's November 2024 sheet, matched to the cent.
 *
 * NSSF Year 2 limits (Feb 2024): 7,000 / 36,000 at 6% give the flat 420 and
 * 1,740 that appear on every standard row of his sheet. SHIF and AHL were
 * not yet deductible; AHL carried a 15% relief instead.
 */
export const KENYA_PAYROLL_RULES_2024: KenyaPayrollRules = {
  label: "2024 (Nov 2024 baseline)",
  effectiveFrom: "2024-01",
  statutoryBasis: "basic",
  nssfRate: 0.06,
  nssfLowerLimit: 7000,
  nssfUpperLimit: 36000,
  nssfBasis: "gross",
  shifRate: 0.0275,
  shifDeductible: false,
  ahlRate: 0.015,
  ahlDeductible: false,
  ahlReliefRate: 0.15,
  pensionEmployeeRate: 0.05,
  pensionEmployeeCap: 20000,
  pensionEmployerRate: 0.10,
  personalReliefStandard: 2400,
  nhifReliefRate: 0,
  nitaFlatPerEmployee: 50,
  payeBands: PAYE_BANDS_FROM_JULY_2023,
}

/**
 * Tax Laws (Amendment) Act 2024, in force 27 December 2024: SHIF and AHL
 * contributions became deductible from taxable pay, the 15% AHL relief was
 * withdrawn (the deduction replaces it), and the pension deductible cap rose
 * from 20,000 to 30,000 a month. NSSF Year 3 limits (8,000 / 72,000) applied
 * from February 2025 — January 2025 strictly sat on the Year 2 limits, a
 * one-month imprecision accepted here rather than a fourth card.
 *
 * CONFIRM against the finance manager's sheet for any 2025 month before
 * relying on it — no 2025 workbook has been reconciled yet.
 */
export const KENYA_PAYROLL_RULES_2025: KenyaPayrollRules = {
  ...KENYA_PAYROLL_RULES_2024,
  label: "2025 (TLAA 2024 + NSSF Year 3)",
  effectiveFrom: "2025-01",
  nssfLowerLimit: 8000,
  nssfUpperLimit: 72000,
  shifDeductible: true,
  ahlDeductible: true,
  ahlReliefRate: 0,
  pensionEmployeeCap: 30000,
}

/**
 * NSSF Year 4 limits from February 2026. The 9,000 / 108,000 figures are the
 * published step-up but have NOT been reconciled against a live workbook —
 * CONFIRM against cell N8 of the finance manager's August 2026 sheet (his
 * Tier II formula shows the upper limit he applied) before sign-off.
 */
export const KENYA_PAYROLL_RULES_2026: KenyaPayrollRules = {
  ...KENYA_PAYROLL_RULES_2025,
  label: "2026 (NSSF Year 4) — confirm vs Aug 2026 sheet",
  effectiveFrom: "2026-02",
  nssfLowerLimit: 9000,
  nssfUpperLimit: 108000,
}

/** Every card, oldest first. Add a new card here when the rules change; nothing else needs touching. */
export const KENYA_PAYROLL_RULE_CARDS: readonly KenyaPayrollRules[] = [
  KENYA_PAYROLL_RULES_2024,
  KENYA_PAYROLL_RULES_2025,
  KENYA_PAYROLL_RULES_2026,
]

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * The rule card in force for a pay month ("YYYY-MM"). Picks the latest card
 * whose `effectiveFrom` is on or before the month. Throws on a malformed
 * month, or a month earlier than any card — running pay with no rules is
 * never the right silent fallback.
 */
export function rulesForMonth(month: string): KenyaPayrollRules {
  if (!MONTH_RE.test(month)) {
    throw new Error(`rulesForMonth: month must be "YYYY-MM", got "${month}"`)
  }
  let chosen: KenyaPayrollRules | undefined
  for (const card of KENYA_PAYROLL_RULE_CARDS) {
    // "YYYY-MM" strings compare correctly as plain strings.
    if (card.effectiveFrom <= month) chosen = card
  }
  if (!chosen) {
    throw new Error(
      `rulesForMonth: no statutory rules on file for ${month} (earliest card is ${KENYA_PAYROLL_RULE_CARDS[0].effectiveFrom})`,
    )
  }
  return chosen
}

/** The current calendar month as "YYYY-MM" — for callers with no pay month in hand. */
export function currentPayMonth(): string {
  return new Date().toISOString().slice(0, 7)
}
