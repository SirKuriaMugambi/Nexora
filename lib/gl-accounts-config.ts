/**
 * Chart-of-accounts mapping for payroll → AX journal postings.
 *
 * PROVENANCE — read before changing anything here:
 *
 * - Codes marked "SOURCED" were pulled directly from the AX main-account
 *   numbers already hard-coded in app/(workspace)/payroll/page.tsx's GL tab
 *   (41000, 41770, 41800, 11500, 18150) — those in turn trace back to the
 *   finance manager's own reference workbook, sheet "Integrating with AX
 *   cost center" (rows 152–183), so they're the most authoritative codes
 *   available in this repo.
 * - Codes marked "ASSUMPTION" are new — introduced because the existing UI
 *   mock's account mapping doesn't actually balance (it never credited a
 *   payable for the Pension Fund debit, and it reused account 11500 for
 *   BOTH "Net Salaries Payable" and "KRA PAYE Payable", which is almost
 *   certainly a copy-paste bug rather than a deliberate shared account).
 *   These need finance-manager confirmation before anything posts for real.
 */

export const PAYROLL_GL_ACCOUNTS = {
  // ── Expense accounts (dimensioned per cost centre) ──────────────────────
  salaryExpense: { code: "41000", name: "Salary & Wages Expense", provenance: "SOURCED" as const },
  employerStatutoryExpense: {
    code: "41770",
    name: "Employer Statutory Contributions Expense (Pension-ER, NITA)",
    provenance: "SOURCED" as const,
  },
  nonCashBenefitsClearing: {
    code: "41790",
    name: "Non-Cash Benefits in Kind (Fringe Benefit Tax) Clearing",
    provenance: "ASSUMPTION" as const,
  },

  // ── Liability accounts (company-wide, not dimensioned by cost centre —
  //    KRA/NSSF/SHIF/pension fund don't care which department the pay came
  //    from; the remittance is one aggregate payment) ─────────────────────
  netPayPayable: { code: "11500", name: "Net Salaries Payable", provenance: "SOURCED" as const },
  payePayable: {
    code: "18100",
    name: "KRA PAYE Payable",
    provenance: "ASSUMPTION" as const,
    note: "The existing UI mock reused account 11500 (same as Net Salaries Payable) for this — almost certainly a bug. Given a distinct code here instead.",
  },
  statutoryPayable: {
    code: "18150",
    name: "Statutory Payable (NSSF, SHIF, AHL)",
    provenance: "SOURCED" as const,
  },
  pensionPayable: {
    code: "18160",
    name: "Pension Fund Payable (Employee + Employer)",
    provenance: "ASSUMPTION" as const,
    note: "The existing UI mock only ever debited Pension (41800) with no matching credit — its totals didn't actually balance. Added this payable to close the loop.",
  },
  nitaPayable: { code: "18170", name: "NITA Payable", provenance: "ASSUMPTION" as const },
  otherDeductionsPayable: {
    code: "18180",
    name: "Other Payroll Deductions Payable (Advances, HELB, Loans, SACCO)",
    provenance: "ASSUMPTION" as const,
  },
} as const

/**
 * Liability/payable postings are booked to this dimension — payroll
 * statutory remittances are a Finance-department, company-wide obligation,
 * not attributable to the originating employee's own cost centre.
 */
export const PAYROLL_LIABILITY_DIMENSION = {
  department: "FIN",
  costCentre: "121",
} as const

/**
 * The FULL Dynamics AX account strings, exactly as they appear in the
 * finance manager's own AX payroll upload ("AX Payroll format -sample.xlsx",
 * Sheet1, the August 2026 voucher SAL0000138). This is the first
 * document-level source for the complete "MainAccount-SubAccount[-CostCentre]"
 * strings AX actually imports — the bare 5-digit codes above only ever came
 * from the UI mock. Every entry here is SOURCED from that file; there are no
 * assumptions in this block. It also settles two of the open questions in the
 * PAYROLL_GL_ACCOUNTS notes: PAYE is NOT booked to 11500 (it sits with NITA
 * and AHL in 18150-09060), and pension has its own expense line (41800) with
 * its payable in the same 11500-06020 clearing account as net pay.
 *
 * Used by lib/ax-journal-builder.ts. PAYROLL_GL_ACCOUNTS above still drives
 * the older CSV journal and its tests; both are kept until Tony confirms the
 * AX upload is the one he'll actually post from.
 */
export const AX_JOURNAL_ACCOUNTS = {
  // ── Credit side (company-wide, no cost centre in the account string) ─────
  /** Net pay, NSSF, PRS, HELB, SACCO, PENSION, SHIF, bank-loan recoveries. */
  salariesClearing: "11500-06020",
  /** Staff receivables — company/car loans and salary advances recovered. */
  staffLoansReceivable: "14320-04230",
  /** KRA-side payables: PAYE, NITA, AHL. */
  taxPayable: "18150-09060",
  /** Always present at 0 in Tony's upload — AX's own rounding line. */
  rounding: "61280-61320-201-KE",

  // ── Debit side (cost-centred: `${prefix}-${costCentre}`) ──────────────────
  salariesExpensePrefix: "41000-40110",
  /** Production bonus / sales commission / overtime — "PROD", "SALES". */
  variablePayExpensePrefix: "41100-41010",
  internSalariesExpensePrefix: "41300-41030",
  nitaExpensePrefix: "41500-41050",
  /** Employer NSSF and employer AHL. */
  employerStatutoryExpensePrefix: "41770-41100",
  employerPensionExpensePrefix: "41800-41110",

  // ── Bank module ────────────────────────────────────────────────────────────
  bankAccount: "BARKSH",
} as const

/**
 * The text suffix Tony uses on the 41100 (variable pay) line depends on the
 * cost centre: production overtime/bonus is "PROD", sales commission is
 * "SALES". Only those two appear in his sample; any other cost centre with
 * OT/bonus falls back to "OT".
 */
export const AX_VARIABLE_PAY_LABEL_BY_COST_CENTRE: Record<string, string> = {
  "511": "PROD",
  "512": "PROD",
  "204": "SALES",
}
