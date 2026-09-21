/**
 * Reads a payroll Excel template and extracts per-employee input rows.
 *
 * This generalizes the header-detection/junk-row-filtering logic that
 * originally lived only in scripts/import-employees-to-supabase.js (a
 * one-off CLI script against the reference workbook) into a reusable,
 * testable module: same column-header-driven parsing, but callable from an
 * API route against whatever monthly variable-inputs file finance uploads,
 * not just the original reference file. It does not assume a fixed column
 * order or a fixed row layout — only that a header row exists somewhere in
 * the sheet containing a "Staff No" cell, matching the finance manager's
 * actual template structure as seen in reference-data/CA- AI Payroll
 * automation project.xlsx.
 */

import * as XLSX from "xlsx"
import { categoryForHeader, type VariablePayCategory } from "@/lib/variable-pay"

export interface ParsedPayrollRow {
  id: string
  name: string
  kraPin: string
  department: string
  baseSalary: number
  bonusCommission: number
  fringeBenefit: number
  transportAllowance: number
  arrears: number
  otOther: number
  /**
   * Every variable-pay column the sheet actually carried, keyed by category —
   * bonuses, overtime, advances, loans, SACCO and the rest. A category whose
   * column is absent is simply not present here, so the month keeps the
   * employee's standard value for it rather than being zeroed.
   */
  variable: Partial<Record<VariablePayCategory, number>>
}

export interface ParseWorkbookResult {
  rows: ParsedPayrollRow[]
  skipped: Array<{ row: number; reason: string }>
  /** Which variable-pay categories the sheet carried, in column order. */
  categories: VariablePayCategory[]
}

const JUNK_KEYWORDS = [
  "total", "totals", "grand total", "subtotal",
  "part time", "category", "department",
  "staff no", "name", "pin no", "basic", "gross", "net pay",
]

function isJunkRow(staffNo: string, rawName: string, kraPin: string): boolean {
  const staffLower = staffNo.trim().toLowerCase()
  const nameLower = rawName.trim().toLowerCase()
  const pinLower = kraPin.trim().toLowerCase()
  return JUNK_KEYWORDS.some((kw) => staffLower === kw || nameLower === kw || pinLower === kw)
}

function isRealName(value: string): boolean {
  const v = value.trim()
  return v.length > 0 && /[A-Za-z]/.test(v)
}

function isCurrencyLike(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  return /^[\d,]+(\.\d+)?$/.test(v) && (v.includes(",") || v.includes("."))
}

function normalizeNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const cleaned = String(value).replace(/[^0-9.-]/g, "").trim()
  if (!cleaned) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/**
 * Parses a single worksheet (already-decrypted, already-loaded via
 * XLSX.read) into normalized payroll rows. Exported separately from
 * `parsePayrollWorkbook` so tests can build a worksheet in-memory via
 * `XLSX.utils.aoa_to_sheet` without needing a real .xlsx file on disk.
 */
export function parsePayrollWorksheet(worksheet: XLSX.WorkSheet): ParseWorkbookResult {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: false })

  const headerIndex = rows.findIndex((row) => Array.isArray(row) && row.includes("Staff No"))
  if (headerIndex === -1) {
    throw new Error('Could not locate a header row containing "Staff No" in this worksheet.')
  }

  const header = rows[headerIndex].map((cell) => String(cell ?? "").trim())
  const declaredStaffIndex = header.findIndex((cell) => cell === "Staff No")
  const declaredNameIndex = header.findIndex((cell) => cell === "Name")
  const declaredPinIndex = header.findIndex((cell) => cell === "Pin No")

  // Defensive check: in at least one real finance-manager template (the
  // pilot's reference workbook), the "Staff No"/"Name" header labels are
  // shifted one column left of the real data — the column literally
  // labeled "Staff No" holds a throwaway row-sequence number (1,2,3,...),
  // while the real staff number sits one column over, under a "Name"
  // label with no actual name data (purely numeric). Detected by sampling
  // the first few data rows: if "Staff No" is an exact 1,2,3,... sequence
  // AND "Name" is non-name (no letters) across that same sample, treat
  // "Name" as the real ID column instead of trusting the header text.
  function looksShifted(): boolean {
    if (declaredNameIndex === -1) return false

    // Collect the first few rows that carry real identity data (staff no,
    // name, or pin), skipping any leading spacer row directly under the
    // header. A spacer row can still have stray formula values in unrelated
    // columns (confirmed in the reference workbook), so blankness is judged
    // only by the identity columns — the same rule the main parsing loop
    // below uses to skip non-employee rows — not by scanning every column.
    const sampleRows: unknown[][] = []
    for (let i = headerIndex + 1; i < rows.length && sampleRows.length < 5; i++) {
      const dataRow = (rows[i] ?? []) as unknown[]
      const staffVal = String(dataRow[declaredStaffIndex] ?? "").trim()
      const nameVal = String(dataRow[declaredNameIndex] ?? "").trim()
      const pinVal = declaredPinIndex >= 0 ? String(dataRow[declaredPinIndex] ?? "").trim() : ""
      if (staffVal || nameVal || pinVal) sampleRows.push(dataRow)
    }
    if (sampleRows.length < 2) return false

    return sampleRows.every((dataRow, k) => {
      const staffVal = String(dataRow[declaredStaffIndex] ?? "").trim()
      const nameVal = String(dataRow[declaredNameIndex] ?? "").trim()
      return staffVal === String(k + 1) && nameVal.length > 0 && !isRealName(nameVal)
    })
  }

  const shifted = looksShifted()
  const staffIndex = shifted ? declaredNameIndex : declaredStaffIndex
  const nameIndex = shifted ? -1 : declaredNameIndex // no real name column exists when shifted
  const pinIndex = declaredPinIndex
  const basicIndex = header.findIndex((cell) => cell.includes("Basic"))
  const bonusIndex = header.findIndex((cell) => cell.includes("Bonus/Comm"))
  const fringeIndex = header.findIndex((cell) => cell.includes("Fringe benefit"))
  const transportIndex = header.findIndex((cell) => cell.includes("Transport/Hse Allowance"))
  const arrearsIndex = header.findIndex((cell) => cell.includes("Arrears"))
  const othersIndex = header.findIndex((cell) => cell.includes("Salary Arrears/OT/Others"))
  const departmentIndex = header.findIndex((cell) => cell === "Category")

  // Every column that names a variable-pay category. The identity columns
  // are excluded so a "Name" or "Category" header can never be mistaken for
  // a pay column, and the first column claiming a category wins.
  const identityColumns = new Set([staffIndex, nameIndex, pinIndex, departmentIndex, basicIndex])
  const variableColumns = new Map<VariablePayCategory, number>()
  header.forEach((cell, index) => {
    if (identityColumns.has(index)) return
    const category = categoryForHeader(cell)
    if (category && !variableColumns.has(category)) variableColumns.set(category, index)
  })

  const result: ParsedPayrollRow[] = []
  const skipped: Array<{ row: number; reason: string }> = []

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = (rows[i] ?? []) as unknown[]
    const rawStaffNo = String(row[staffIndex] ?? "").trim()
    const rawName = String(row[nameIndex] ?? "").trim()
    const kraPin = String(row[pinIndex] ?? "").trim()

    if (!rawStaffNo && !rawName && !kraPin) continue

    if (!rawStaffNo && !isRealName(rawName)) {
      skipped.push({ row: i + 1, reason: "no_staff_no_or_name" })
      continue
    }
    if (isCurrencyLike(rawName) || isCurrencyLike(rawStaffNo)) {
      skipped.push({ row: i + 1, reason: "currency_value_not_a_name" })
      continue
    }
    if (isJunkRow(rawStaffNo, rawName, kraPin)) {
      skipped.push({ row: i + 1, reason: "junk_row" })
      continue
    }

    const staffNo = rawStaffNo || rawName
    const looksLikeARealName = rawName && !/^\d+$/.test(rawName)
    const employeeName = looksLikeARealName ? rawName : `Employee ${staffNo || i}`

    result.push({
      id: staffNo || `ROW-${i}`,
      name: employeeName,
      kraPin: kraPin || "",
      department: String(row[departmentIndex] ?? "").trim() || "Production",
      baseSalary: normalizeNumber(row[basicIndex]),
      bonusCommission: normalizeNumber(row[bonusIndex]),
      fringeBenefit: normalizeNumber(row[fringeIndex]),
      transportAllowance: normalizeNumber(row[transportIndex]),
      arrears: normalizeNumber(row[arrearsIndex]),
      otOther: normalizeNumber(row[othersIndex]),
      variable: Object.fromEntries(
        [...variableColumns.entries()].map(([category, index]) => [category, normalizeNumber(row[index])]),
      ) as Partial<Record<VariablePayCategory, number>>,
    })
  }

  return { rows: result, skipped, categories: [...variableColumns.keys()] }
}

export interface ParsePayrollWorkbookOptions {
  /** Password if the workbook is encrypted (this template's reference file is). */
  password?: string
  /** Sheet name to read; defaults to the first sheet. */
  sheetName?: string
}

/**
 * Parses a raw .xlsx file buffer (e.g. from a multipart file upload) into
 * normalized payroll rows. Handles password-protected workbooks via the
 * `officecrypto-tool` package (already a project dependency, used by
 * scripts/import-employees-to-supabase.js for the same reference file).
 */
export async function parsePayrollWorkbook(
  buffer: Buffer,
  options: ParsePayrollWorkbookOptions = {},
): Promise<ParseWorkbookResult> {
  let workbookBuffer: Buffer = buffer

  if (options.password) {
    const officeCrypto = await import("officecrypto-tool")
    workbookBuffer = await officeCrypto.decrypt(buffer, { password: options.password })
  }

  const workbook = XLSX.read(workbookBuffer, { type: "buffer" })

  if (options.sheetName) {
    const worksheet = workbook.Sheets[options.sheetName]
    if (!worksheet) {
      throw new Error(`Sheet "${options.sheetName}" not found in workbook. Available sheets: ${workbook.SheetNames.join(", ")}`)
    }
    return parsePayrollWorksheet(worksheet)
  }

  // No sheet specified — a workbook may have unrelated sheets alongside the
  // real employee data (the reference workbook has two: a wide per-employee
  // working sheet with no "Staff No" header at all, and the row-based sheet
  // this parser expects). Try each sheet and use the first one that
  // actually parses, rather than assuming sheet order.
  const errors: string[] = []
  for (const name of workbook.SheetNames) {
    try {
      return parsePayrollWorksheet(workbook.Sheets[name])
    } catch (err) {
      errors.push(`"${name}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  throw new Error(`No sheet with a "Staff No" header row found. Tried: ${errors.join("; ")}`)
}
