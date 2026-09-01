import { validatePayrollRows, type PayrollValidationRow } from "@/lib/payroll-validation"

const row = (overrides: Partial<PayrollValidationRow>): PayrollValidationRow => ({
  id: "1000",
  name: "Test Employee",
  kra_pin: "A00000000Z1",
  base_salary: 100000,
  net_salary: 60000,
  bank_name: "KCB",
  bank_account_number: "1234567890",
  email: "test@chrysal.com",
  ...overrides,
})

describe("validatePayrollRows", () => {
  it("returns no issues for a clean employee", () => {
    expect(validatePayrollRows([row({})])).toEqual([])
  })

  it("flags missing KRA PIN as an error", () => {
    const issues = validatePayrollRows([row({ kra_pin: "" })])
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("error")
    expect(issues[0].message).toMatch(/KRA PIN/)
  })

  it("flags negative net pay as an error", () => {
    const issues = validatePayrollRows([row({ net_salary: -5000 })])
    expect(issues.some((i) => i.severity === "error" && /negative/i.test(i.message))).toBe(true)
  })

  it("flags zero basic salary as an error", () => {
    const issues = validatePayrollRows([row({ base_salary: 0 })])
    expect(issues.some((i) => i.severity === "error")).toBe(true)
  })

  it("treats missing bank details and email as warnings, including the N/A placeholder", () => {
    const issues = validatePayrollRows([row({ bank_name: "N/A", email: null })])
    expect(issues).toHaveLength(2)
    expect(issues.every((i) => i.severity === "warning")).toBe(true)
  })

  it("sorts errors before warnings", () => {
    const issues = validatePayrollRows([
      row({ id: "1002", email: null }),
      row({ id: "1001", kra_pin: null }),
    ])
    expect(issues[0].severity).toBe("error")
    expect(issues[0].employeeId).toBe("1001")
    expect(issues[issues.length - 1].severity).toBe("warning")
  })
})
