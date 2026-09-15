import { EXCEPTION_KINDS, exceptionDetails, hasException } from "@/lib/employee-exceptions"
import type { Employee } from "@/lib/seeds"

const base = {
  id: "1000", name: "E", kra_pin: "P", grade: "Staff", cost_centre: "511", department: "Production",
  base_salary: 100000, bonus_commission: 0, fringe_benefit: 0, transport_allowance: 0, arrears: 0, ot_other: 0,
  gross_salary: 100000, voluntary_pension: 0, defined_pension_ee: 0,
} as unknown as Employee

describe("employee exceptions", () => {
  it("a standard employee has none", () => {
    expect(hasException(base)).toBe(false)
    expect(exceptionDetails(base)).toEqual([])
  })

  it("spells out each override with its value, and 0% pension as outside the scheme", () => {
    const e = { ...base, pension_rate_override: 0, paye_band_flat_deduction: 20000 } as Employee
    expect(hasException(e)).toBe(true)
    expect(exceptionDetails(e)).toEqual([
      "Employee pension 0% — outside the scheme, so the company's 10% is nil too",
      "PAYE bands computed on gross − KES 20,000, not on taxable pay",
    ])
    expect(exceptionDetails(e, "paye_band_flat_deduction")).toHaveLength(1)
    expect(exceptionDetails({ ...base, paye_band_flat_deduction: 0 } as Employee)[0]).toMatch(/raw gross/)
    expect(exceptionDetails({ ...base, nssf_t2_override: 1093.64 } as Employee)[0]).toBe(
      "NSSF Tier II fixed at KES 1,093.64 instead of the standard amount",
    )
  })

  it("a zero personal-relief or NSSF override is not an exception (matches the table's badge)", () => {
    expect(hasException({ ...base, personal_relief_override: 0 } as Employee)).toBe(false)
    expect(hasException({ ...base, nssf_t2_override: 0 } as Employee)).toBe(false)
  })

  it("every kind has a label and a detail", () => {
    for (const k of EXCEPTION_KINDS) {
      expect(k.label.length).toBeGreaterThan(0)
      expect(k.detail(1).length).toBeGreaterThan(0)
    }
  })
})
