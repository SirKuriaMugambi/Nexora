import * as XLSX from "xlsx"
import {
  applyVariablePay,
  categoryForHeader,
  describeChanges,
  planUploadForEmployee,
  variablePayChanges,
  VARIABLE_PAY_CATEGORIES,
} from "@/lib/variable-pay"
import { parsePayrollWorksheet } from "@/lib/excel-ingest"

// A standard employee: one recurring loan, nothing else variable.
const standard = {
  bonus_commission: 0, arrears: 0, ot_other: 0, transport_allowance: 5437.22,
  fringe_benefit: 0, voluntary_pension: 0, advances: 0, helb: 0,
  company_loan: 12000, bank_loan: 0, sacco: 0,
}

describe("categoryForHeader", () => {
  it("maps the finance manager's real column headers", () => {
    expect(categoryForHeader("Bonus/Comm")).toBe("bonus_commission")
    expect(categoryForHeader("Fringe benefit Loan-non cash")).toBe("fringe_benefit")
    expect(categoryForHeader("Transport/Hse Allowance")).toBe("transport_allowance")
    expect(categoryForHeader("Arrears")).toBe("arrears")
    expect(categoryForHeader("Salary Arrears/OT/Others")).toBe("ot_other")
    expect(categoryForHeader("Advances")).toBe("advances")
    expect(categoryForHeader("HELB")).toBe("helb")
    expect(categoryForHeader("Company loan")).toBe("company_loan")
    expect(categoryForHeader("Bank loan")).toBe("bank_loan")
    expect(categoryForHeader("SACCO")).toBe("sacco")
    expect(categoryForHeader("Voluntary pension Contribution")).toBe("voluntary_pension")
  })
  it("does not let 'Arrears' claim the OT/Others column, and ignores non-pay headers", () => {
    expect(categoryForHeader("Salary Arrears/OT/Others")).toBe("ot_other")
    expect(categoryForHeader("Staff No")).toBeNull()
    expect(categoryForHeader("Name")).toBeNull()
    expect(categoryForHeader("Basic")).toBeNull()
    expect(categoryForHeader("")).toBeNull()
  })
})

describe("applyVariablePay / variablePayChanges", () => {
  it("returns the same object when there is nothing to apply", () => {
    expect(applyVariablePay(standard, [])).toBe(standard)
    expect(variablePayChanges(standard, [])).toEqual([])
    expect(describeChanges([])).toBe("No changes — standard pay")
  })

  it("overrides only the categories that have rows, and reports each as a change", () => {
    const rows = [
      { employee_id: "1013", category: "bonus_commission" as const, amount: 15000 },
      { employee_id: "1013", category: "advances" as const, amount: 10000, note: "school fees" },
      { employee_id: "1013", category: "company_loan" as const, amount: 0 },
    ]
    const applied = applyVariablePay(standard, rows)
    expect(applied).not.toBe(standard)
    expect(applied.bonus_commission).toBe(15000)
    expect(applied.advances).toBe(10000)
    expect(applied.company_loan).toBe(0)          // an override to zero is a real change
    expect(applied.transport_allowance).toBe(5437.22) // untouched

    const changes = variablePayChanges(standard, rows)
    expect(changes.map((c) => [c.category, c.standard, c.actual, c.delta])).toEqual([
      ["bonus_commission", 0, 15000, 15000],
      ["advances", 0, 10000, 10000],
      ["company_loan", 12000, 0, -12000],
    ])
    expect(changes[1].note).toBe("school fees")
    expect(describeChanges(changes)).toBe("+ Bonus / Commission 15,000 · − Advances 10,000 · + Company Loan 12,000")
  })

  it("a stored row equal to the standard value is not a change", () => {
    const rows = [{ employee_id: "1013", category: "transport_allowance" as const, amount: 5437.22 }]
    expect(variablePayChanges(standard, rows)).toEqual([])
  })
})

describe("planUploadForEmployee", () => {
  it("stores deviations, clears categories the sheet sets back to standard, leaves absent ones alone", () => {
    const plan = planUploadForEmployee(standard, {
      bonus_commission: 5000,        // new → store
      transport_allowance: 5437.22,  // same as standard → clear any override
      company_loan: 0,               // differs from the 12,000 standard → store 0
      // advances absent → untouched
    })
    expect(plan.store).toEqual([
      { category: "bonus_commission", amount: 5000 },
      { category: "company_loan", amount: 0 },
    ])
    expect(plan.clear).toEqual(["transport_allowance"])
  })
})

describe("parsePayrollWorksheet — variable-pay columns", () => {
  it("captures every category column the sheet carries, and only those", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Staff No", "Name", "Pin No", "Basic", "Bonus/Comm", "Fringe benefit Loan-non cash", "Transport/Hse Allowance", "Arrears", "Salary Arrears/OT/Others", "Advances", "SACCO"],
      ["1013", "Employee 1013", "A00000000Z13", "129133.86", "15000", "8082.24", "5437.22", "0", "0", "10000", "2500"],
      ["1017", "Employee 1017", "A00000000Z17", "57446.27", "0", "1499.7", "0", "0", "8000", "", "0"],
    ])
    const result = parsePayrollWorksheet(ws)
    expect(result.categories).toEqual([
      "bonus_commission", "fringe_benefit", "transport_allowance", "arrears", "ot_other", "advances", "sacco",
    ])
    expect(result.rows[0].variable).toEqual({
      bonus_commission: 15000, fringe_benefit: 8082.24, transport_allowance: 5437.22,
      arrears: 0, ot_other: 0, advances: 10000, sacco: 2500,
    })
    // a blank cell in a present column reads as 0; an absent column is absent
    expect(result.rows[1].variable.advances).toBe(0)
    expect(result.rows[1].variable.helb).toBeUndefined()
    expect(result.rows[1].variable.ot_other).toBe(8000)
    // the legacy fields still line up
    expect(result.rows[1].otOther).toBe(8000)
    expect(result.rows[0].baseSalary).toBeCloseTo(129133.86, 2)
  })

  it("every category has a label and at least one alias", () => {
    for (const c of VARIABLE_PAY_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.aliases.length).toBeGreaterThan(0)
      expect(categoryForHeader(c.aliases[0])).toBe(c.key)
    }
  })
})
