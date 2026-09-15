import {
  PAYROLL_VALIDATION_FIX_FIELD,
  fixLinkFor,
  validatePayrollRows,
  type PayrollValidationCode,
  type PayrollValidationRow,
} from "@/lib/payroll-validation"

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

describe("fixLinkFor — every cause opens Employee Master at the field that fixes it", () => {
  const codes: PayrollValidationCode[] = [
    "missing_kra_pin", "zero_basic", "negative_net", "missing_bank",
    "missing_bank_routing", "duplicate_emp_code", "missing_email",
  ]
  it("has a target field for every cause", () => {
    for (const code of codes) {
      expect(PAYROLL_VALIDATION_FIX_FIELD[code]).toBeTruthy()
      expect(fixLinkFor({ employeeId: "1000", code })).toBe(`/employees?edit=1000&field=${PAYROLL_VALIDATION_FIX_FIELD[code]}`)
    }
  })
  it("points at the specific blank field when a cause covers two", () => {
    const [noAcct] = validatePayrollRows([row({ bank_account_number: "" })])
    expect(fixLinkFor(noAcct)).toBe("/employees?edit=1000&field=bank_account_number")
    const [noBank] = validatePayrollRows([row({ bank_name: "N/A" })])
    expect(fixLinkFor(noBank)).toBe("/employees?edit=1000&field=bank_name")
    const [noBranch] = validatePayrollRows([row({ bank_branch_code: "" })])
    expect(fixLinkFor(noBranch)).toBe("/employees?edit=1000&field=bank_branch_code")
    const [noCode] = validatePayrollRows([row({ emp_code: null })])
    expect(fixLinkFor(noCode)).toBe("/employees?edit=1000&field=emp_code")
  })
  it("sends a duplicate EMP code to the EMP code box, and a missing email to the email box", () => {
    const issues = validatePayrollRows([row({ id: "1011", emp_code: "EMP011" }), row({ id: "1012", emp_code: "EMP011", email: "" })])
    expect(fixLinkFor(issues.find((i) => i.employeeId === "1011")!)).toBe("/employees?edit=1011&field=emp_code")
    expect(fixLinkFor(issues.find((i) => i.employeeId === "1012" && i.code === "missing_email")!)).toBe("/employees?edit=1012&field=email")
  })
})
