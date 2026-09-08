/**
 * Builds the payroll journal in the EXACT row/column layout of the finance
 * manager's Dynamics AX upload file ("AX Payroll format -sample.xlsx"), so
 * the system's output can be dropped straight into AX — and, just as
 * importantly, laid side by side with his own sheet for a line-by-line match.
 *
 * Layout (one sheet, ten columns, no headers beyond row 1):
 *   Module | Voucher | Date | Number | Text | Currency |
 *   Amount in transaction currency | Amount | Dimensions | Number2
 *
 * Row blocks, in the order his file has them:
 *   1. Ledger CREDITS (negative) — company-wide payables:
 *        11500-06020  Salaries YYMM            = net pay
 *        11500-06020  -NSSF                    = NSSF employee + employer
 *        11500-06020  -PRS                     = voluntary pension (input)
 *        11500-06020  -HELB / -SACCO / -SHIF
 *        11500-06020  -PENSION                 = pension EE (capped) + excess over cap + ER
 *        11500-06020  -Bank loan               (ours — his sample had none that month)
 *        14320-04230  -Company loan / -Advances (staff receivables recovered)
 *        18150-09060  -PAYE / -NITA / -AHL     (AHL = employee + employer)
 *   2. Ledger rounding line 61280-61320-201-KE at 0 (always present in his file).
 *   3. Ledger DEBITS (positive) — expenses per cost centre:
 *        41500-41050-CC  -NITA       41770-41100-CC  -NSSF (ER) / -AHL (ER)
 *        41100-41010-CC  -PROD/-SALES/-OT (ot_other + bonus_commission)
 *        41800-41110-CC  -PENSION (ER)          41300-41030-CC  -INTERN
 *        41000-40110-CC  Salaries YYMM (basic + transport + arrears)
 *      A cost-centre-split employee (e.g. the GM, 50/50 across 121 and 512)
 *      gets his share as its OWN line under each cost centre rather than
 *      being merged into that centre's total — that's how Tony's file shows
 *      him (the paired "6480 / 3240" style lines), and it's what lets him
 *      spot the split at a glance.
 *   4. Bank lines (BARKSH, negative, no text) — one per 11500-06020 credit,
 *      i.e. everything actually paid out of the bank at payroll time. PAYE/
 *      NITA/AHL are not here (paid to KRA later via iTax) and neither are
 *      the 14320 loan recoveries (no cash moves).
 *
 * What is deliberately NOT in this journal:
 *   - The fringe benefit. It's a non-cash, tax-only figure: taxed inside
 *     gross, never paid, never remitted. Tony's upload has no line for it
 *     and neither does this one. (The older lib/journal-builder.ts CSV books
 *     it to a clearing account instead — a different, also-balancing choice.)
 *
 * Employer NSSF and employer AHL are 1:1 matches of the employee amounts
 * (NSSF Act 2013 s.20; Affordable Housing Act 2024 s.4) — the payroll engine
 * doesn't store them, so they're derived here. Tony's file books both
 * (the 41770-41100-CC lines), so leaving them out would be a visible gap.
 *
 * Balance proof (per employee, so it holds for any headcount):
 *   net_pay = gross − fringe − total_deductions               (engine step 8)
 *   total_deductions = paye + nssf_ee + shif + ahl_ee + pension_ee
 *                    + pension_excess + voluntary + advances + helb
 *                    + company_loan + bank_loan + sacco       (engine step 7)
 *   ⇒ credits = net_pay + every deduction + ER nssf + ER ahl + ER pension + nita
 *             = (gross − fringe) + ER costs
 *             = (basic + transport + arrears + ot + bonus) + ER costs = debits ∎
 */

import * as XLSX from "xlsx"
import { AX_JOURNAL_ACCOUNTS, AX_VARIABLE_PAY_LABEL_BY_COST_CENTRE } from "@/lib/gl-accounts-config"
import { allocateEmployeeAmount, type EmployeeForAllocation } from "@/lib/cost-allocation"

export interface AxJournalEntry {
  basic_salary: number
  bonus_commission: number
  fringe_benefit: number
  transport_allowance: number
  arrears: number
  ot_other: number
  voluntary_pension: number
  advances: number
  helb: number
  company_loan: number
  bank_loan: number
  sacco: number
  nssf_t1: number
  nssf_t2: number
  shif: number
  ahl: number
  defined_pension_ee: number
  employer_pension: number
  net_paye: number
  total_deductions: number
  net_pay: number
}

export interface AxJournalEmployeeInput {
  employee: EmployeeForAllocation & { grade?: string | null }
  entry: AxJournalEntry
}

export interface AxJournalOptions {
  /** AX voucher number, e.g. "SAL0000138". */
  voucher: string
  /** Posting date written to every row. */
  postingDate: Date
  /** Flat NITA levy per employee per month (employer-borne). */
  nitaFlatPerEmployee: number
  currency?: string
}

export interface AxJournalRow {
  module: "Ledger" | "Bank"
  voucher: string
  date: Date
  number: string
  text: string
  currency: string
  /** Positive = debit, negative = credit — AX's own sign convention. */
  amount: number
}

export interface AxJournal {
  month: string
  voucher: string
  rows: AxJournalRow[]
  ledgerDebitTotal: number
  ledgerCreditTotal: number
  bankTotal: number
  /**
   * What landed on AX's "Ledger - rounding curr" line. The register stores
   * each deduction rounded to 2dp but total_deductions rounded from the raw
   * sum, so per employee the parts can differ from the total by ±0.01; net
   * pay was computed from the raw total, so the credits must follow the
   * totals and the cent-level residual goes here — exactly what that line
   * exists for in Tony's file. Anything beyond a few cents is a real bug,
   * and the route refuses to serve it.
   */
  roundingAdjustment: number
  isBalanced: boolean
}

/** Largest rounding residual that can plausibly be 2dp noise for one payroll run. */
export const MAX_ROUNDING_ADJUSTMENT = 1.0

function round2(n: number): number {
  return +n.toFixed(2)
}

/** "2026-08" → "2608", the YYMM Tony puts in every Text cell. */
export function axPeriodLabel(month: string): string {
  const [year, mm] = month.split("-")
  return `${year.slice(2)}${mm}`
}

/**
 * Register rounding: each deduction is stored rounded to 2dp but
 * total_deductions is rounded from the raw sum, so the parts can sit a cent
 * or two off the total. A genuine above-cap pension excess is never that
 * small (it grows 5 cents per shilling of basic above the cap threshold), so
 * anything within this band is treated as noise and left for the rounding
 * line rather than booked as pension.
 */
const REGISTER_ROUNDING_NOISE = 0.02

/**
 * The pension contribution above the statutory tax-deductible cap. The
 * engine (lib/payroll-engine.ts step 2) still deducts it — it's real money
 * remitted to the fund — but the register only stores the *input* voluntary
 * figure, so it has to be recovered from the deduction identity:
 * total_deductions is defined as the named components below plus this.
 */
export function pensionExcessOverCap(entry: AxJournalEntry): number {
  const named =
    entry.net_paye + entry.nssf_t1 + entry.nssf_t2 + entry.shif + entry.ahl
    + entry.defined_pension_ee + entry.voluntary_pension
    + entry.advances + entry.helb + entry.company_loan + entry.bank_loan + entry.sacco
  const gap = round2(entry.total_deductions - named)
  return gap > REGISTER_ROUNDING_NOISE ? gap : 0
}

export function buildAxPayrollJournal(
  month: string,
  inputs: AxJournalEmployeeInput[],
  options: AxJournalOptions,
): AxJournal {
  const currency = options.currency ?? "KES"
  const period = axPeriodLabel(month)
  const salariesText = `Salaries ${period}`
  const suffix = (s: string) => `${salariesText}-${s}`

  // ── Company-wide credit totals ───────────────────────────────────────────
  let netPay = 0
  let nssfEmployee = 0
  let prs = 0
  let helb = 0
  let sacco = 0
  let pensionEmployeeCapped = 0
  let pensionExcess = 0
  let pensionEmployer = 0
  let shif = 0
  let bankLoan = 0
  let companyLoan = 0
  let advances = 0
  let paye = 0
  let nita = 0
  let ahlEmployee = 0

  // ── Per-cost-centre debit buckets ────────────────────────────────────────
  // Keyed by cost centre, then by "main" or "split:<employeeId>" so a split
  // employee's share stays on its own line the way Tony posts it.
  type Bucket = Map<string, number>
  const bucketsByAccount: Record<string, Map<string, Bucket>> = {
    nita: new Map(),
    nssfEmployer: new Map(),
    ahlEmployer: new Map(),
    variablePay: new Map(),
    pensionEmployer: new Map(),
    intern: new Map(),
    salaries: new Map(),
  }

  const add = (account: keyof typeof bucketsByAccount, costCentre: string, lineKey: string, amount: number) => {
    if (round2(amount) === 0) return
    const byCentre = bucketsByAccount[account]
    let bucket = byCentre.get(costCentre)
    if (!bucket) {
      bucket = new Map()
      byCentre.set(costCentre, bucket)
    }
    bucket.set(lineKey, round2((bucket.get(lineKey) ?? 0) + amount))
  }

  for (const { employee, entry } of inputs) {
    const isSplit = Boolean(
      employee.cost_centre_allocation
      && Object.values(employee.cost_centre_allocation).filter((s) => s > 0).length > 1,
    )
    const lineKey = isSplit ? `split:${employee.id}` : "main"
    const isIntern = (employee.grade ?? "").trim().toLowerCase() === "intern"

    const cashEarnings = entry.basic_salary + entry.transport_allowance + entry.arrears
    const variablePay = entry.ot_other + entry.bonus_commission
    const nssfEe = entry.nssf_t1 + entry.nssf_t2
    const excess = pensionExcessOverCap(entry)

    // Debits, allocated across the employee's real cost-centre split.
    for (const { dimension, amount } of allocateEmployeeAmount(employee, cashEarnings)) {
      add(isIntern ? "intern" : "salaries", dimension.costCentre, lineKey, amount)
    }
    for (const { dimension, amount } of allocateEmployeeAmount(employee, variablePay)) {
      add("variablePay", dimension.costCentre, lineKey, amount)
    }
    for (const { dimension, amount } of allocateEmployeeAmount(employee, options.nitaFlatPerEmployee)) {
      add("nita", dimension.costCentre, lineKey, amount)
    }
    for (const { dimension, amount } of allocateEmployeeAmount(employee, nssfEe)) {
      add("nssfEmployer", dimension.costCentre, lineKey, amount)
    }
    for (const { dimension, amount } of allocateEmployeeAmount(employee, entry.ahl)) {
      add("ahlEmployer", dimension.costCentre, lineKey, amount)
    }
    for (const { dimension, amount } of allocateEmployeeAmount(employee, entry.employer_pension)) {
      add("pensionEmployer", dimension.costCentre, lineKey, amount)
    }

    // Credits.
    netPay += entry.net_pay
    nssfEmployee += nssfEe
    prs += entry.voluntary_pension
    helb += entry.helb
    sacco += entry.sacco
    pensionEmployeeCapped += entry.defined_pension_ee
    pensionExcess += excess
    pensionEmployer += entry.employer_pension
    shif += entry.shif
    bankLoan += entry.bank_loan
    companyLoan += entry.company_loan
    advances += entry.advances
    paye += entry.net_paye
    nita += options.nitaFlatPerEmployee
    ahlEmployee += entry.ahl
  }

  const rows: AxJournalRow[] = []
  const push = (module: AxJournalRow["module"], number: string, text: string, amount: number) => {
    const value = round2(amount)
    if (value === 0 && number !== AX_JOURNAL_ACCOUNTS.rounding) return
    rows.push({ module, voucher: options.voucher, date: options.postingDate, number, text, currency, amount: value })
  }

  // 1. Ledger credits. The 11500 block is also what the Bank block repeats.
  const clearingCredits: Array<[string, number]> = [
    [salariesText, netPay],
    [suffix("NSSF"), nssfEmployee * 2],
    [suffix("PRS"), prs],
    [suffix("HELB"), helb],
    [suffix("SACCO"), sacco],
    [suffix("PENSION"), pensionEmployeeCapped + pensionExcess + pensionEmployer],
    [suffix("SHIF"), shif],
    [suffix("Bank loan"), bankLoan],
  ]
  for (const [text, amount] of clearingCredits) {
    push("Ledger", AX_JOURNAL_ACCOUNTS.salariesClearing, text, -amount)
  }
  push("Ledger", AX_JOURNAL_ACCOUNTS.staffLoansReceivable, suffix("Company loan"), -companyLoan)
  push("Ledger", AX_JOURNAL_ACCOUNTS.staffLoansReceivable, suffix("Advances"), -advances)
  push("Ledger", AX_JOURNAL_ACCOUNTS.taxPayable, suffix("PAYE"), -paye)
  push("Ledger", AX_JOURNAL_ACCOUNTS.taxPayable, suffix("NITA"), -nita)
  push("Ledger", AX_JOURNAL_ACCOUNTS.taxPayable, suffix("AHL"), -ahlEmployee * 2)

  // 2. Rounding line — always emitted, exactly as in Tony's file. Its amount
  //    is set once every other ledger line is known (see below).
  push("Ledger", AX_JOURNAL_ACCOUNTS.rounding, `Ledger - rounding curr  ${options.voucher}`, 0)
  const roundingRow = rows[rows.length - 1]

  // 3. Ledger debits per cost centre, main line first then each split share.
  const emitDebits = (
    account: keyof typeof bucketsByAccount,
    prefix: string,
    textFor: (costCentre: string) => string,
  ) => {
    const byCentre = bucketsByAccount[account]
    for (const costCentre of [...byCentre.keys()].sort()) {
      const bucket = byCentre.get(costCentre)!
      const keys = [...bucket.keys()].sort((a, b) => (a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)))
      for (const key of keys) {
        push("Ledger", `${prefix}-${costCentre}`, textFor(costCentre), bucket.get(key)!)
      }
    }
  }
  emitDebits("nita", AX_JOURNAL_ACCOUNTS.nitaExpensePrefix, () => suffix("NITA"))
  emitDebits("nssfEmployer", AX_JOURNAL_ACCOUNTS.employerStatutoryExpensePrefix, () => suffix("NSSF"))
  emitDebits("ahlEmployer", AX_JOURNAL_ACCOUNTS.employerStatutoryExpensePrefix, () => suffix("AHL"))
  emitDebits(
    "variablePay",
    AX_JOURNAL_ACCOUNTS.variablePayExpensePrefix,
    (cc) => suffix(AX_VARIABLE_PAY_LABEL_BY_COST_CENTRE[cc] ?? "OT"),
  )
  emitDebits("pensionEmployer", AX_JOURNAL_ACCOUNTS.employerPensionExpensePrefix, () => suffix("PENSION"))
  emitDebits("intern", AX_JOURNAL_ACCOUNTS.internSalariesExpensePrefix, () => suffix("INTERN"))
  emitDebits("salaries", AX_JOURNAL_ACCOUNTS.salariesExpensePrefix, () => salariesText)

  // 4. Bank block — the cash actually leaving BARKSH at payroll time.
  for (const [, amount] of clearingCredits) {
    push("Bank", AX_JOURNAL_ACCOUNTS.bankAccount, "", -amount)
  }

  // The residual between every other ledger debit and credit lands on the
  // rounding line, so the voucher always sums to zero the way AX needs.
  const ledgerRows = rows.filter((r) => r.module === "Ledger")
  const signedSum = ledgerRows.reduce((s, r) => s + r.amount, 0)
  const roundingAdjustment = round2(-signedSum)
  roundingRow.amount = roundingAdjustment

  const ledgerDebitTotal = round2(ledgerRows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0))
  const ledgerCreditTotal = round2(-ledgerRows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0))
  const bankTotal = round2(-rows.filter((r) => r.module === "Bank").reduce((s, r) => s + r.amount, 0))

  return {
    month,
    voucher: options.voucher,
    rows,
    ledgerDebitTotal,
    ledgerCreditTotal,
    bankTotal,
    roundingAdjustment,
    isBalanced:
      Math.abs(ledgerDebitTotal - ledgerCreditTotal) < 0.005
      && Math.abs(roundingAdjustment) <= MAX_ROUNDING_ADJUSTMENT,
  }
}

/**
 * The worksheet with Tony's exact header row, column widths and number
 * formats (dates as mm-dd-yy, amounts as #,##0.00), so a diff against his
 * own file lines up cell for cell.
 */
export function axJournalToSheet(journal: AxJournal): XLSX.WorkSheet {
  const header = [
    "Module", "Voucher", "Date", "Number", "Text", "Currency",
    "Amount in transaction currency", "Amount", "Dimensions", "Number2",
  ]
  const data: unknown[][] = [
    header,
    ...journal.rows.map((r) => [r.module, r.voucher, r.date, r.number, r.text, r.currency, r.amount, r.amount, "", ""]),
  ]

  const sheet = XLSX.utils.aoa_to_sheet(data, { cellDates: true })
  sheet["!cols"] = [10, 14, 13, 22, 38, 12, 34, 15, 14, 11].map((wch) => ({ wch }))

  for (let i = 0; i < journal.rows.length; i++) {
    const excelRow = i + 2
    const dateCell = sheet[`C${excelRow}`]
    if (dateCell) dateCell.z = "mm-dd-yy"
    for (const col of ["G", "H"]) {
      const cell = sheet[`${col}${excelRow}`]
      if (cell) cell.z = "#,##0.00"
    }
  }
  return sheet
}

/** The .xlsx bytes, single sheet named "Sheet1" like Tony's file. */
export function axJournalToXlsx(journal: AxJournal): Buffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, axJournalToSheet(journal), "Sheet1")
  return Buffer.from(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellDates: true }))
}

