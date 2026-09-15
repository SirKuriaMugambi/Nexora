import { validatePayrollRows, type PayrollValidationRow } from "@/lib/payroll-validation"

const row = (overrides: Partial<PayrollValidationRow>): PayrollValidationRow => ({
  id: "1000",
  name: "Test Employee",
  kra_pin: "A00000000Z1",
  base_salary: 100000,
  net_salary: 60000,
  bank_name: "KCB",
  bank_account_number: "1234567890",
  bank_branch_code: "01100",
  emp_code: "EMP001",
  email: "test@chrysal.com",
  ...overrides,
})

describe("validatePayrollRows", () => {
  it("returns no issues for a clean employee", () => {
    expect(validatePayrollRows([row({})])).toEqual([])
  })

  it("warns when the bank routing fields the payment file needs are missing", () => {
    const issues = validatePayrollRows([row({ bank_branch_code: null })])
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
    expect(issues[0].message).toMatch(/branch code \/ EMP code/)
    expect(validatePayrollRows([row({ emp_code: "" })])).toHaveLength(1)
  })

  it("warns every holder of an EMP code shared by two employees, case-insensitively", () => {
    const issues = validatePayrollRows([
      row({ id: "1011", emp_code: "EMP011" }),
      row({ id: "1012", emp_code: "emp011" }),
      row({ id: "1013", emp_code: "EMP013" }),
    ])
    expect(issues.map((i) => i.employeeId)).toEqual(["1011", "1012"])
    expect(issues[0].message).toMatch(/EMP011 is also assigned to 1012/)
    expect(issues[1].message).toMatch(/EMP011 is also assigned to 1011/)
  })

  it("tags every issue with a stable cause code", () => {
    const issues = validatePayrollRows([row({ kra_pin: "", email: null, emp_code: "" })])
    expect(issues.map((i) => i.code)).toEqual(["missing_kra_pin", "missing_bank_routing", "missing_email"])
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
