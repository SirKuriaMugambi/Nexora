/**
 * Converts a computed payroll run into a GAAP-correct, dimensioned general
 * journal ready to post to Dynamics AX. See lib/gl-accounts-config.ts for
 * the account mapping and which codes are sourced vs. assumed.
 *
 * GAAP treatment implemented here (derive, don't just copy the existing UI
 * mock's GL tab — that mock's debits and credits don't actually balance):
 *   Dr Salary & Wages Expense           = gross_salary (per cost centre)
 *   Dr Employer Statutory Contributions = employer pension match + NITA (per cost centre)
 *   Cr Non-Cash Benefits Clearing       = fringe_benefit (per cost centre) — the
 *                                         taxable, non-cash portion of gross pay
 *                                         that's never actually disbursed as cash
 *                                         nor withheld as a statutory deduction.
 *   Cr Net Salaries Payable             = net_salary (company-wide)
 *   Cr KRA PAYE Payable                 = net_paye (company-wide)
 *   Cr Statutory Payable (NSSF/SHIF/AHL)= nssf + shif + ahl (company-wide)
 *   Cr Pension Fund Payable             = pension EE + ER (company-wide)
 *   Cr NITA Payable                     = flat NITA per employee (company-wide)
 *   Cr Other Deductions Payable         = advances + helb + loans + sacco + voluntary pension
 *
 * Every employee's Dr and Cr lines net to zero by construction (see the
 * balance proof in lib/__tests__/journal-builder.test.ts), so the whole
 * journal balances regardless of how many employees or cost centres it covers.
 */

import { PAYROLL_GL_ACCOUNTS, PAYROLL_LIABILITY_DIMENSION } from "@/lib/gl-accounts-config"
import { allocateEmployeeAmount, type AxDimension, type EmployeeForAllocation } from "@/lib/cost-allocation"
import { KENYA_PAYROLL_RULES_2024 } from "@/lib/payroll-rules-config"
import type { PayrollInputs, PayrollResult } from "@/lib/payroll-engine"

export interface JournalLine {
  lineNumber: number
  accountCode: string
  accountName: string
  debit: number
  credit: number
  dimension: AxDimension
  description: string
}

export interface PayrollJournal {
  month: string
  journalName: string
  currency: string
  lines: JournalLine[]
  totalDebit: number
  totalCredit: number
  isBalanced: boolean
}

export interface PayrollJournalEmployeeInput {
  employee: EmployeeForAllocation
  inputs: PayrollInputs
  result: PayrollResult
}

/**
 * "Other deductions" (advances, HELB, company/bank loans, SACCO, voluntary
 * pension) aren't broken out as individual PayrollResult fields — but they're
 * fully recoverable from it: total_deductions is defined (see
 * lib/payroll-engine.ts) as net_paye + nssf + shif + ahl + defined_pension_ee
 * + voluntary + (advances+helb+company_loan+bank_loan+sacco), so subtracting
 * every other named component leaves exactly this bucket.
 */
function otherDeductionsFromResult(result: PayrollResult): number {
  return round2(
    result.total_deductions
      - result.net_paye
      - result.nssf_t1
      - result.nssf_t2
      - result.shif
      - result.ahl
      - result.defined_pension_ee,
  )
}

function round2(n: number): number {
  return +n.toFixed(2)
}

export function buildPayrollJournal(
  month: string,
  employeeInputs: PayrollJournalEmployeeInput[],
  currency = "KES",
): PayrollJournal {
  // Accumulate per-cost-centre expense totals (dimensioned lines).
  const salaryByDimension = new Map<string, { dimension: AxDimension; amount: number }>()
  const employerStatutoryByDimension = new Map<string, { dimension: AxDimension; amount: number }>()
  const nonCashByDimension = new Map<string, { dimension: AxDimension; amount: number }>()

  // Company-wide liability totals (not dimensioned by cost centre).
  let netPayTotal = 0
  let payeTotal = 0
  let statutoryPayableTotal = 0 // NSSF + SHIF + AHL
  let pensionPayableTotal = 0 // EE + ER
  let nitaPayableTotal = 0
  let otherDeductionsTotal = 0

  const addToMap = (map: Map<string, { dimension: AxDimension; amount: number }>, dimension: AxDimension, amount: number) => {
    const key = `${dimension.department}::${dimension.costCentre}`
    const existing = map.get(key)
    if (existing) {
      existing.amount = round2(existing.amount + amount)
    } else {
      map.set(key, { dimension, amount: round2(amount) })
    }
  }

  for (const { employee, inputs, result } of employeeInputs) {
    // Splits across the employee's real cost-centre allocation when one is
    // set (see lib/cost-allocation.ts) — a no-op split for the common
    // single-cost-centre case, a real multi-line split otherwise. Each of
    // the three expense buckets is allocated independently since they're
    // different amounts, but they land on identical dimensions/percentages
    // for a given employee, so the three resulting line sets always share
    // the same cost-centre breakdown.
    for (const { dimension, amount } of allocateEmployeeAmount(employee, result.gross_salary)) {
      addToMap(salaryByDimension, dimension, amount)
    }
    for (const { dimension, amount } of allocateEmployeeAmount(
      employee,
      result.defined_pension_er + KENYA_PAYROLL_RULES_2024.nitaFlatPerEmployee,
    )) {
      addToMap(employerStatutoryByDimension, dimension, amount)
    }
    for (const { dimension, amount } of allocateEmployeeAmount(employee, inputs.fringe_benefit)) {
      addToMap(nonCashByDimension, dimension, amount)
    }

    netPayTotal += result.net_salary
    payeTotal += result.net_paye
    statutoryPayableTotal += result.nssf_t1 + result.nssf_t2 + result.shif + result.ahl
    pensionPayableTotal += result.defined_pension_ee + result.defined_pension_er
    nitaPayableTotal += KENYA_PAYROLL_RULES_2024.nitaFlatPerEmployee
    otherDeductionsTotal += otherDeductionsFromResult(result)
  }

  const lines: JournalLine[] = []
  let lineNumber = 1

  const pushLine = (accountKey: keyof typeof PAYROLL_GL_ACCOUNTS, debit: number, credit: number, dimension: AxDimension, description: string) => {
    if (round2(debit) === 0 && round2(credit) === 0) return
    const account = PAYROLL_GL_ACCOUNTS[accountKey]
    lines.push({
      lineNumber: lineNumber++,
      accountCode: account.code,
      accountName: account.name,
      debit: round2(debit),
      credit: round2(credit),
      dimension,
      description,
    })
  }

  // Debits — one line per cost centre per account.
  for (const { dimension, amount } of salaryByDimension.values()) {
    pushLine("salaryExpense", amount, 0, dimension, `Gross salary & wages — ${dimension.costCentre} (${month})`)
  }
  for (const { dimension, amount } of employerStatutoryByDimension.values()) {
    pushLine("employerStatutoryExpense", amount, 0, dimension, `Employer pension match + NITA — ${dimension.costCentre} (${month})`)
  }

  // Credits — non-cash benefit clearing, dimensioned the same way as the expense it offsets.
  for (const { dimension, amount } of nonCashByDimension.values()) {
    pushLine("nonCashBenefitsClearing", 0, amount, dimension, `Non-cash fringe benefit clearing — ${dimension.costCentre} (${month})`)
  }

  // Credits — company-wide liabilities.
  pushLine("netPayPayable", 0, netPayTotal, PAYROLL_LIABILITY_DIMENSION, `Net salaries payable (${month})`)
  pushLine("payePayable", 0, payeTotal, PAYROLL_LIABILITY_DIMENSION, `KRA PAYE payable (${month})`)
  pushLine("statutoryPayable", 0, statutoryPayableTotal, PAYROLL_LIABILITY_DIMENSION, `NSSF/SHIF/AHL payable (${month})`)
  pushLine("pensionPayable", 0, pensionPayableTotal, PAYROLL_LIABILITY_DIMENSION, `Pension fund payable, EE+ER (${month})`)
  pushLine("nitaPayable", 0, nitaPayableTotal, PAYROLL_LIABILITY_DIMENSION, `NITA payable (${month})`)
  pushLine("otherDeductionsPayable", 0, otherDeductionsTotal, PAYROLL_LIABILITY_DIMENSION, `Advances/HELB/loans/SACCO payable (${month})`)

  const totalDebit = round2(lines.reduce((sum, l) => sum + l.debit, 0))
  const totalCredit = round2(lines.reduce((sum, l) => sum + l.credit, 0))

  return {
    month,
    journalName: `PAYROLL-${month}`,
    currency,
    lines,
    totalDebit,
    totalCredit,
    isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
  }
}

// code -> "SOURCED" | "ASSUMPTION", so the export can flag which lines use a
// real Chrysal account number vs. one invented to close a gap in the
// original mock. See lib/gl-accounts-config.ts for the full provenance notes.
const PROVENANCE_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.values(PAYROLL_GL_ACCOUNTS).map((account) => [account.code, account.provenance]),
)

/**
 * CSV export of a built journal — one row per Dr/Cr line, ready to hand to
 * an AX admin for file-based import (or to eyeball before wiring up the
 * live API). Every row is tagged SOURCED or ASSUMPTION so it's obvious at a
 * glance which account codes still need Tony's confirmation before this is
 * used for a real posting — do not remove that column even once some codes
 * are confirmed, since it'll take several rounds to close them all out.
 */
export function buildPayrollJournalCSV(journal: PayrollJournal): string {
  const rows: string[][] = [
    [`Chrysal Africa Ltd — AX Payroll Journal — ${journal.journalName}`],
    [`Currency: ${journal.currency}`, `Balanced: ${journal.isBalanced ? "YES" : "NO — DO NOT POST"}`],
    [],
    ["Line", "Account Code", "Account Name", "Debit", "Credit", "Department", "Cost Centre", "Description", "Account Code Status"],
    ...journal.lines.map((line) => [
      String(line.lineNumber),
      line.accountCode,
      line.accountName,
      line.debit ? line.debit.toFixed(2) : "",
      line.credit ? line.credit.toFixed(2) : "",
      line.dimension.department,
      line.dimension.costCentre,
      line.description,
      PROVENANCE_BY_CODE[line.accountCode] === "ASSUMPTION"
        ? "PLACEHOLDER — confirm with Tony before real posting"
        : "Confirmed from Chrysal's reference file",
    ]),
    [],
    ["", "", "TOTAL", journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2)],
  ]

  return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n")
}
