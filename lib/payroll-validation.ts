/**
 * Pre-flight checks run before a payroll run is computed/saved, so data
 * problems surface as a readable list up front instead of as a wrong
 * payslip, a rejected bank line, or a silently skipped email later.
 *
 * Severity semantics:
 *   error   — the run should not proceed (blocks Run Payroll client-side,
 *             and POST /api/payroll rejects with the same checks).
 *   warning — the run may proceed, but a downstream output will be
 *             degraded (bank batch line skipped, payslip email skipped).
 */

export interface PayrollValidationRow {
  id: string
  name: string
  kra_pin?: string | null
  base_salary: number
  net_salary: number
  bank_name?: string | null
  bank_account_number?: string | null
  bank_branch_code?: string | null
  emp_code?: string | null
  email?: string | null
}

/** Stable cause key — the message is for people, this is for grouping and counting. */
export type PayrollValidationCode =
  | "missing_kra_pin"
  | "zero_basic"
  | "negative_net"
  | "missing_bank"
  | "missing_bank_routing"
  | "duplicate_emp_code"
  | "missing_email"

/** Short human label per cause, for the summary line above the full list. */
export const PAYROLL_VALIDATION_CAUSE_LABELS: Record<PayrollValidationCode, string> = {
  missing_kra_pin: "no KRA PIN",
  zero_basic: "basic salary zero or negative",
  negative_net: "negative net pay",
  missing_bank: "no bank details",
  missing_bank_routing: "no branch code / EMP code",
  duplicate_emp_code: "EMP code shared with another employee",
  missing_email: "no email",
}

/** The Employee Master field to open for each cause. */
export const PAYROLL_VALIDATION_FIX_FIELD: Record<PayrollValidationCode, string> = {
  missing_kra_pin: "kra_pin",
  zero_basic: "base_salary",
  negative_net: "advances",
  missing_bank: "bank_name",
  missing_bank_routing: "bank_branch_code",
  duplicate_emp_code: "emp_code",
  missing_email: "email",
}

export interface PayrollValidationIssue {
  employeeId: string
  name: string
  severity: "error" | "warning"
  code: PayrollValidationCode
  message: string
  /** The exact field to open, when the cause covers more than one (e.g. branch code vs EMP code). */
  field?: string
}

/**
 * Where to send someone to fix an issue: Employee Master, with that employee's
 * form open and the offending field focused. The page reads these params.
 */
export function fixLinkFor(issue: Pick<PayrollValidationIssue, "employeeId" | "code" | "field">): string {
  const field = issue.field ?? PAYROLL_VALIDATION_FIX_FIELD[issue.code]
  return `/employees?edit=${encodeURIComponent(issue.employeeId)}&field=${encodeURIComponent(field)}`
}

const isBlank = (v: string | null | undefined) => !v || v.trim() === "" || v.trim().toUpperCase() === "N/A"

export function validatePayrollRows(rows: PayrollValidationRow[]): PayrollValidationIssue[] {
  const issues: PayrollValidationIssue[] = []

  // The bank file carries the EMP code as the reference on every payment
  // line. Two people on one code still get paid (the bank routes on account
  // number), but the statement can no longer say who was paid what.
  const holdersByEmpCode = new Map<string, string[]>()
  for (const row of rows) {
    const code = row.emp_code?.trim().toUpperCase()
    if (!code) continue
    holdersByEmpCode.set(code, [...(holdersByEmpCode.get(code) ?? []), row.id])
  }

  for (const row of rows) {
    const push = (severity: "error" | "warning", code: PayrollValidationCode, message: string, field?: string) =>
      issues.push({ employeeId: row.id, name: row.name, severity, code, message, ...(field ? { field } : {}) })

    if (isBlank(row.kra_pin)) {
      push("error", "missing_kra_pin", "Missing KRA PIN — statutory filings (iTax, P9) will be invalid.")
    }
    if (row.base_salary <= 0) {
      push("error", "zero_basic", "Basic salary is zero or negative.")
    }
    if (row.net_salary < 0) {
      push(
        "error",
        "negative_net",
        `Net pay is negative (KES ${row.net_salary.toLocaleString("en-KE", { minimumFractionDigits: 2 })}) — deductions exceed gross pay.`,
      )
    }
    if (isBlank(row.bank_name) || isBlank(row.bank_account_number)) {
      push("warning", "missing_bank", "No bank details on file — this employee will be missing from the bank batch file.",
        isBlank(row.bank_name) ? "bank_name" : "bank_account_number")
    }
    if (isBlank(row.bank_branch_code) || isBlank(row.emp_code)) {
      push("warning", "missing_bank_routing", "No bank branch code / EMP code on file — the bank payment file cannot be generated until this is added in Employee Master.",
        isBlank(row.bank_branch_code) ? "bank_branch_code" : "emp_code")
    }
    const code = row.emp_code?.trim().toUpperCase()
    const others = code ? (holdersByEmpCode.get(code) ?? []).filter((id) => id !== row.id) : []
    if (others.length > 0) {
      push("warning", "duplicate_emp_code", `EMP code ${code} is also assigned to ${others.join(", ")} — each employee needs their own bank file reference.`)
    }
    if (isBlank(row.email)) {
      push("warning", "missing_email", "No email on file — payslip emailing will skip this employee.")
    }
  }

  // Errors first, then warnings, stable by staff number within each group.
  return issues.sort((a, b) =>
    a.severity !== b.severity
      ? (a.severity === "error" ? -1 : 1)
      : a.employeeId.localeCompare(b.employeeId),
  )
}
