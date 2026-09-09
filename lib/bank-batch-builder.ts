/**
 * Builds the salary payment file in the EXACT layout of Chrysal's own bank
 * upload — taken from the "BANK DETAILS" sheet of the finance manager's
 * November 2024 workbook, which is a real file the bank accepted.
 *
 * This replaces a generic placeholder that invented its own columns. That
 * placeholder was honest about being a guess, but it produced something the
 * bank would have rejected: no header or trailer records, no branch codes, no
 * employee references, and a column order of its own devising.
 *
 * Layout — four record types, distinguished by the number in column A:
 *
 *   1  header   LOCAL | CR | DDMMYYYY | 000800
 *   2  debit    company a/c | bank | branch | KES | DDMMYYYY | narrative |
 *               reference | total | company name
 *   3  detail   employee a/c | branch code | DDMMYYYY | KES | amount |
 *               staff no | emp code                      (one per employee)
 *   9  trailer  total record count | total amount
 *
 * The record count in the trailer counts EVERY row including the header and
 * itself — 46 employees produced 49 in the source file.
 */

import * as XLSX from "xlsx"

/**
 * Constants read from Chrysal's own November 2024 file. The company account
 * and name are what the bank debits and shows on the statement; the batch
 * code and reference are the bank's own routing values.
 */
export const BANK_BATCH_CONFIG = {
  companyAccount: "REDACTED-ACCOUNT",
  companyBankCode: "03",
  companyBranchCode: "045",
  companyName: "CHRYSALAFRICALTD",
  /** Column E of the header row — the bank's batch/product code. */
  batchCode: "000800",
  /** Column H of the debit row — the payment reference. */
  paymentReference: "SALARYPAYT",
  currency: "KES",
} as const

export interface BankBatchRow {
  staffNo: string
  name: string
  bankAccountNumber: string
  /** 5-digit bank clearing code, e.g. "03095". */
  bankBranchCode: string
  /** Employee reference the bank file carries, e.g. "EMP001". */
  empCode: string
  netSalary: number
}

export interface BankBatchResult {
  rows: unknown[][]
  recordCount: number
  total: number
  /** Employees left out because they had no account, branch code or reference. */
  skipped: Array<{ staffNo: string; name: string; reason: string }>
}

/** The bank writes dates as a plain DDMMYYYY number, e.g. 26112024. */
export function bankDateNumber(date: Date): number {
  const dd = String(date.getDate()).padStart(2, "0")
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  return Number(`${dd}${mm}${date.getFullYear()}`)
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

/** Column G of the debit row — "NOV SALARY" in the source file. */
export function salaryNarrative(month: string): string {
  const [, mm] = month.split("-")
  return `${MONTHS[Number(mm) - 1] ?? mm} SALARY`
}

function round2(n: number): number {
  return +n.toFixed(2)
}

export function buildBankBatch(
  rows: BankBatchRow[],
  month: string,
  paymentDate: Date,
): BankBatchResult {
  const date = bankDateNumber(paymentDate)
  const skipped: BankBatchResult["skipped"] = []

  // A row the bank cannot route is worse than a missing one — it fails the
  // whole upload — so incomplete employees are held back and reported rather
  // than written with blanks.
  const payable = rows.filter((r) => {
    const missing: string[] = []
    if (!r.bankAccountNumber || r.bankAccountNumber.trim() === "" || r.bankAccountNumber === "N/A") missing.push("account number")
    if (!r.bankBranchCode || r.bankBranchCode.trim() === "") missing.push("bank branch code")
    if (!r.empCode || r.empCode.trim() === "") missing.push("employee reference")
    if (!(r.netSalary > 0)) missing.push("a positive net salary")
    if (missing.length) {
      skipped.push({ staffNo: r.staffNo, name: r.name, reason: `no ${missing.join(", ")}` })
      return false
    }
    return true
  })

  const total = round2(payable.reduce((s, r) => s + r.netSalary, 0))
  const C = BANK_BATCH_CONFIG

  const out: unknown[][] = []
  out.push([1, "LOCAL", "CR", date, C.batchCode])
  out.push([
    2, C.companyAccount, C.companyBankCode, C.companyBranchCode, C.currency,
    date, salaryNarrative(month), C.paymentReference, total, C.companyName,
  ])
  for (const r of payable) {
    out.push([
      3, r.bankAccountNumber, r.bankBranchCode, date, C.currency,
      round2(r.netSalary), r.staffNo, r.empCode,
    ])
  }
  // Counts every row in the file, this trailer included.
  const recordCount = out.length + 1
  out.push([9, recordCount, total])

  return { rows: out, recordCount, total, skipped }
}

/** The .xlsx the bank is given, matching the source file's column widths. */
export function bankBatchToXlsx(batch: BankBatchResult): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(batch.rows)
  sheet["!cols"] = [6, 18, 10, 12, 8, 14, 10, 12, 16, 20].map((wch) => ({ wch }))

  // Amounts to 2dp; account numbers and codes as text so leading zeros on
  // "0951061050" and "03095" survive — losing those breaks the upload.
  for (let i = 0; i < batch.rows.length; i++) {
    const excelRow = i + 1
    const type = batch.rows[i][0]
    if (type === 3) {
      const amt = sheet[`F${excelRow}`]
      if (amt) amt.z = "0.00"
      for (const col of ["B", "C", "G", "H"]) {
        const cell = sheet[`${col}${excelRow}`]
        if (cell) { cell.t = "s"; cell.v = String(cell.v) }
      }
    } else if (type === 2) {
      const amt = sheet[`I${excelRow}`]
      if (amt) amt.z = "0.00"
      for (const col of ["B", "C", "D"]) {
        const cell = sheet[`${col}${excelRow}`]
        if (cell) { cell.t = "s"; cell.v = String(cell.v) }
      }
    } else if (type === 9) {
      const amt = sheet[`C${excelRow}`]
      if (amt) amt.z = "0.00"
    } else if (type === 1) {
      const code = sheet[`E${excelRow}`]
      if (code) { code.t = "s"; code.v = String(code.v) }
    }
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, "BANK DETAILS")
  return Buffer.from(XLSX.write(workbook, { type: "array", bookType: "xlsx" }))
}
