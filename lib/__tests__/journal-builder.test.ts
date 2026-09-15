import { computePayroll } from "@/lib/payroll-engine"
import { KENYA_PAYROLL_RULES_2024 } from "@/lib/payroll-rules-config"
import { buildPayrollJournal, type PayrollJournalEmployeeInput } from "@/lib/journal-builder"
import { PAYROLL_GL_ACCOUNTS, PAYROLL_LIABILITY_DIMENSION } from "@/lib/gl-accounts-config"

function makeEmployee(
  overrides: Partial<PayrollJournalEmployeeInput["inputs"]> & {
    id: string; department: string; cost_centre: string
    cost_centre_allocation?: Record<string, number> | null
  },
): PayrollJournalEmployeeInput {
  const { cost_centre_allocation, ...inputOverrides } = overrides
  const inputs = {
    base_salary: 100000,
    bonus_commission: 0,
    fringe_benefit: 0,
    transport_allowance: 0,
    arrears: 0,
    ot_other: 0,
    voluntary_pension: 0,
    advances: 0,
    helb: 0,
    company_loan: 0,
    bank_loan: 0,
    sacco: 0,
    ...inputOverrides,
  }

  return {
    employee: { id: overrides.id, department: overrides.department, cost_centre: overrides.cost_centre, cost_centre_allocation },
    inputs,
    result: computePayroll(inputs, KENYA_PAYROLL_RULES_2024),
  }
}

describe("buildPayrollJournal", () => {
  it("produces a journal where total debits equal total credits, for a single simple employee", () => {
    const journal = buildPayrollJournal("2026-08", [
      makeEmployee({ id: "1", department: "OPS", cost_centre: "511" }),
    ])

    expect(journal.isBalanced).toBe(true)
    expect(journal.totalDebit).toBeCloseTo(journal.totalCredit, 2)
  })

  it("stays balanced across multiple employees with fringe benefits, loans, and different cost centres", () => {
    const journal = buildPayrollJournal("2026-08", [
      makeEmployee({ id: "1", department: "OPS", cost_centre: "511", fringe_benefit: 15000, ot_other: 5000 }),
      makeEmployee({ id: "2", department: "FIN", cost_centre: "121", base_salary: 250000, advances: 10000, sacco: 5000 }),
      makeEmployee({ id: "3", department: "OPS", cost_centre: "512", base_salary: 60000, helb: 3000, company_loan: 2000, bank_loan: 1000 }),
      makeEmployee({ id: "4", department: "FIN", cost_centre: "121", base_salary: 400000, voluntary_pension: 8000 }),
    ])

    expect(journal.isBalanced).toBe(true)
    expect(journal.totalDebit).toBeCloseTo(journal.totalCredit, 2)
  })

  it("dimensions expense lines per cost centre (one line per centre, not one company-wide lump sum)", () => {
    const journal = buildPayrollJournal("2026-08", [
      makeEmployee({ id: "1", department: "OPS", cost_centre: "511" }),
      makeEmployee({ id: "2", department: "OPS", cost_centre: "511" }),
      makeEmployee({ id: "3", department: "FIN", cost_centre: "121" }),
    ])

    const salaryLines = journal.lines.filter((l) => l.accountCode === PAYROLL_GL_ACCOUNTS.salaryExpense.code)
    expect(salaryLines).toHaveLength(2) // one for 511, one for 121
    const cc511Line = salaryLines.find((l) => l.dimension.costCentre === "511")
    expect(cc511Line?.debit).toBeCloseTo(200000, 2) // two employees @ 100k base each
  })

  it("books liability lines to the company-wide Finance dimension, not per employee cost centre", () => {
    const journal = buildPayrollJournal("2026-08", [
      makeEmployee({ id: "1", department: "OPS", cost_centre: "511" }),
    ])

    const netPayLine = journal.lines.find((l) => l.accountCode === PAYROLL_GL_ACCOUNTS.netPayPayable.code)
    expect(netPayLine?.dimension).toEqual(PAYROLL_LIABILITY_DIMENSION)
  })

  it("uses distinct account codes for Net Pay Payable and PAYE Payable (fixing the existing UI mock's account collision)", () => {
    expect(PAYROLL_GL_ACCOUNTS.netPayPayable.code).not.toBe(PAYROLL_GL_ACCOUNTS.payePayable.code)
  })

  it("credits a Pension Payable line matching the debited employer pension contribution (the existing UI mock never did this)", () => {
    const journal = buildPayrollJournal("2026-08", [
      makeEmployee({ id: "1", department: "OPS", cost_centre: "511" }),
    ])

    const pensionCredit = journal.lines.find((l) => l.accountCode === PAYROLL_GL_ACCOUNTS.pensionPayable.code)
    expect(pensionCredit).toBeDefined()
    expect(pensionCredit!.credit).toBeGreaterThan(0)
  })

  it("omits zero-amount lines entirely (e.g. no non-cash benefit clearing line when nobody has a fringe benefit)", () => {
    const journal = buildPayrollJournal("2026-08", [
      makeEmployee({ id: "1", department: "OPS", cost_centre: "511", fringe_benefit: 0 }),
    ])

    const nonCashLine = journal.lines.find((l) => l.accountCode === PAYROLL_GL_ACCOUNTS.nonCashBenefitsClearing.code)
    expect(nonCashLine).toBeUndefined()
  })

  // A shared-services employee (e.g. a General Manager split 50/50 across
  // two cost centres) must produce TWO salary-expense lines, each roughly
  // half the amount, and the whole journal must still balance. This is the
  // exact scenario a database column was added for by a separate, code-blind
  // session without ever being wired into this function — confirming it
  // actually works end to end now that it is.
  it("splits a shared-services employee's expense lines across their real cost-centre allocation", () => {
    const journal = buildPayrollJournal("2026-08", [
      makeEmployee({
        id: "1005", department: "Production", cost_centre: "121",
        cost_centre_allocation: { "121": 0.5, "512": 0.5 },
        base_salary: 440382.84,
      }),
    ])

    const salaryLines = journal.lines.filter((l) => l.accountCode === PAYROLL_GL_ACCOUNTS.salaryExpense.code)
    expect(salaryLines).toHaveLength(2)
    const cc121 = salaryLines.find((l) => l.dimension.costCentre === "121")!
    const cc512 = salaryLines.find((l) => l.dimension.costCentre === "512")!
    expect(cc121.debit).toBeCloseTo(220191.42, 2)
    expect(cc512.debit).toBeCloseTo(220191.42, 2)
    expect(journal.isBalanced).toBe(true)
    expect(journal.totalDebit).toBeCloseTo(journal.totalCredit, 2)
  })

  it("merges a split employee's share into an existing cost-centre line rather than double-booking it", () => {
    const journal = buildPayrollJournal("2026-08", [
      makeEmployee({ id: "1000", department: "Production", cost_centre: "512", base_salary: 100000 }),
      makeEmployee({
        id: "1005", department: "Production", cost_centre: "121",
        cost_centre_allocation: { "121": 0.5, "512": 0.5 },
        base_salary: 40000,
      }),
    ])

    const cc512Lines = journal.lines.filter(
      (l) => l.accountCode === PAYROLL_GL_ACCOUNTS.salaryExpense.code && l.dimension.costCentre === "512",
    )
    // One merged line for CC 512, not two — 1000's full 100k plus 1005's 50% (20k).
    expect(cc512Lines).toHaveLength(1)
    expect(cc512Lines[0].debit).toBeCloseTo(120000, 2)
  })
})
