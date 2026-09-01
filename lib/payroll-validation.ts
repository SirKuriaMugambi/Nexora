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
  email?: string | null
}

export interface PayrollValidationIssue {
  employeeId: string
  name: string
  severity: "error" | "warning"
  message: string
}

const isBlank = (v: string | null | undefined) => !v || v.trim() === "" || v.trim().toUpperCase() === "N/A"

export function validatePayrollRows(rows: PayrollValidationRow[]): PayrollValidationIssue[] {
  const issues: PayrollValidationIssue[] = []

  for (const row of rows) {
    const push = (severity: "error" | "warning", message: string) =>
      issues.push({ employeeId: row.id, name: row.name, severity, message })

    if (isBlank(row.kra_pin)) {
      push("error", "Missing KRA PIN — statutory filings (iTax, P9) will be invalid.")
    }
    if (row.base_salary <= 0) {
      push("error", "Basic salary is zero or negative.")
    }
    if (row.net_salary < 0) {
      push(
        "error",
        `Net pay is negative (KES ${row.net_salary.toLocaleString("en-KE", { minimumFractionDigits: 2 })}) — deductions exceed gross pay.`,
      )
    }
    if (isBlank(row.bank_name) || isBlank(row.bank_account_number)) {
      push("warning", "No bank details on file — this employee will be missing from the bank batch file.")
    }
    if (isBlank(row.email)) {
      push("warning", "No email on file — payslip emailing will skip this employee.")
    }
  }

  // Errors first, then warnings, stable by staff number within each group.
  return issues.sort((a, b) =>
    a.severity !== b.severity
      ? (a.severity === "error" ? -1 : 1)
      : a.employeeId.localeCompare(b.employeeId),
  )
}
