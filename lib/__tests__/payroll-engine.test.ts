import { computePayroll, buildGLPosting, buildCostCentreBreakdown } from "@/lib/payroll-engine"
import {
  KENYA_PAYROLL_RULES_2024,
  KENYA_PAYROLL_RULES_2025,
  KENYA_PAYROLL_RULES_2026,
  rulesForMonth,
} from "@/lib/payroll-rules-config"

// Every figure below was traced from the Nov 2024 workbook, so it is
// asserted on the 2024 card explicitly — never on "whatever is current".
const R2024 = KENYA_PAYROLL_RULES_2024

describe("computePayroll", () => {
  it("computes a simple employee with only basic salary (hand-verified against the KRA bands)", () => {
    const result = computePayroll({
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
    }, R2024)

    expect(result.gross_salary).toBe(100000)
    expect(result.nssf_t1).toBe(420)
    expect(result.nssf_t2).toBe(1740)
    expect(result.shif).toBeCloseTo(2750, 2)
    expect(result.ahl).toBeCloseTo(1500, 2)
    expect(result.defined_pension_ee).toBeCloseTo(5000, 2)
    expect(result.defined_pension_er).toBeCloseTo(10000, 2)
    expect(result.taxable_pay).toBeCloseTo(92840, 2)
    // Band slices measured from (previous ceiling + 1), matching Tony's sheet
    // exactly: 24,000 + (32,333-24,001)*25% + (92,840-32,334)*30%
    expect(result.gross_paye).toBeCloseTo(22634.8, 2)
    expect(result.ahl_relief).toBeCloseTo(225, 2)
    expect(result.net_paye).toBeCloseTo(20009.8, 2)
    expect(result.total_deductions).toBeCloseTo(31419.8, 2)
    expect(result.net_salary).toBeCloseTo(68580.2, 2)
  })

  it("caps the employee pension contribution at the statutory ceiling for high earners", () => {
    const result = computePayroll({
      base_salary: 1000000,
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
    }, R2024)

    // 5% of 1,000,000 = 50,000, capped at 20,000
    expect(result.defined_pension_ee).toBe(20000)
  })

  it("redirects pension contributions above the statutory cap into voluntary deductions instead of dropping them", () => {
    const result = computePayroll({
      base_salary: 1000000,
      bonus_commission: 0,
      fringe_benefit: 0,
      transport_allowance: 0,
      arrears: 0,
      ot_other: 0,
      voluntary_pension: 9000,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
    }, R2024)

    // 5% of 1,000,000 = 50,000; excess over the 20,000 cap is 30,000,
    // which must still land somewhere in total_deductions (as voluntary).
    expect(result.defined_pension_ee).toBe(20000)
    expect(result.total_deductions).toBeCloseTo(
      result.net_paye + result.nssf_t1 + result.nssf_t2 + result.shif + result.ahl
        + result.defined_pension_ee + 9000 + 30000,
      2
    )
  })

  it("matches Tony's source sheet exactly for a real employee (Staff 1002, standard basis)", () => {
    // Reference: reference-data/CA- AI Payroll automation project.xlsx,
    // "Integrating with AX cost center", row 9 (Staff 1002).
    const result = computePayroll({
      base_salary: 240632.93144996982,
      bonus_commission: 0,
      fringe_benefit: 8766.417666666668, // mobile (1,499.751) + meals (600) + car/FBT (6,666.667)
      transport_allowance: 5437.215,
      arrears: 0,
      ot_other: 0,
      voluntary_pension: 0,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
    }, R2024)

    expect(result.gross_salary).toBeCloseTo(254836.56, 2)
    expect(result.gross_paye).toBeCloseTo(66976.28, 2)
  })

  it("matches Tony's source sheet exactly for Staff 1000 (paye_band_flat_deduction = 20,000)", () => {
    const result = computePayroll({
      base_salary: 398051.75285295275,
      bonus_commission: 0,
      fringe_benefit: 545.832,
      transport_allowance: 0,
      arrears: 0,
      ot_other: 0,
      voluntary_pension: 0,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
      paye_band_flat_deduction: 20000,
    }, R2024)

    expect(result.gross_paye).toBeCloseTo(108362.08, 2)
  })

  it("matches Tony's source sheet exactly for Staff 1001 (paye_band_flat_deduction = 45,000)", () => {
    const result = computePayroll({
      base_salary: 440577.9394676755,
      bonus_commission: 0,
      fringe_benefit: 390,
      transport_allowance: 0,
      arrears: 0,
      ot_other: 0,
      voluntary_pension: 0,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
      paye_band_flat_deduction: 45000,
    }, R2024)

    expect(result.gross_paye).toBeCloseTo(113573.18, 2)
  })

  it("matches Tony's source sheet exactly for Staff 1007 (paye_band_flat_deduction = 0 AND pension_rate_override = 0)", () => {
    const result = computePayroll({
      base_salary: 400000,
      bonus_commission: 0,
      fringe_benefit: 1500,
      transport_allowance: 0,
      arrears: 0,
      ot_other: 0,
      voluntary_pension: 0,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
      paye_band_flat_deduction: 0,
      pension_rate_override: 0,
    }, R2024)

    expect(result.gross_paye).toBeCloseTo(115232.80, 2)
    expect(result.defined_pension_ee).toBe(0)
    // Outside the scheme on both sides — Tony's sheet leaves the employer 10% blank too.
    expect(result.defined_pension_er).toBe(0)
  })

  it("matches Tony's source sheet exactly for Staff 1025 (pension_rate_override = 0, standard PAYE basis)", () => {
    const result = computePayroll({
      base_salary: 47802.181875,
      bonus_commission: 0,
      fringe_benefit: 1493.181,
      transport_allowance: 0,
      arrears: 0,
      ot_other: 0,
      voluntary_pension: 0,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
      pension_rate_override: 0,
    }, R2024)

    expect(result.gross_paye).toBeCloseTo(8923.41, 2)
    expect(result.defined_pension_ee).toBe(0)
    expect(result.defined_pension_er).toBe(0)
  })

  it("uses a per-employee NSSF Tier II override when set", () => {
    const result = computePayroll({
      base_salary: 24000,
      bonus_commission: 0,
      fringe_benefit: 600,
      transport_allowance: 0,
      arrears: 0,
      ot_other: 1227.2727272727275,
      voluntary_pension: 0,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
      pension_rate_override: 0,
      nssf_t2_override: 1093.6363636363637,
    }, R2024)

    expect(result.nssf_t2).toBeCloseTo(1093.64, 2)
  })

  it("does not let voluntary pension reduce taxable pay", () => {
    const withVoluntary = computePayroll({
      base_salary: 100000,
      bonus_commission: 0,
      fringe_benefit: 0,
      transport_allowance: 0,
      arrears: 0,
      ot_other: 0,
      voluntary_pension: 5000,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
    }, R2024)
    const withoutVoluntary = computePayroll({
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
    }, R2024)

    expect(withVoluntary.taxable_pay).toBe(withoutVoluntary.taxable_pay)
    // But total deductions (and therefore net salary) must differ by the voluntary amount.
    expect(withVoluntary.total_deductions - withoutVoluntary.total_deductions).toBeCloseTo(5000, 2)
  })

  it("subtracts non-cash fringe benefit from net salary without adding it to deductions", () => {
    const result = computePayroll({
      base_salary: 100000,
      bonus_commission: 0,
      fringe_benefit: 10000,
      transport_allowance: 0,
      arrears: 0,
      ot_other: 0,
      voluntary_pension: 0,
      advances: 0,
      helb: 0,
      company_loan: 0,
      bank_loan: 0,
      sacco: 0,
    }, R2024)

    expect(result.gross_salary).toBe(110000)
    // net_salary = gross - fringe_benefit - total_deductions
    expect(result.net_salary).toBeCloseTo(result.gross_salary - 10000 - result.total_deductions, 2)
  })

  it("respects a personal_relief_override for non-standard (e.g. expatriate) employees", () => {
    const result = computePayroll({
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
      personal_relief_override: 5000,
    }, R2024)

    expect(result.personal_relief).toBe(5000)
  })
})

describe("buildGLPosting", () => {
  it("sums gross, statutory, and net totals across employees, with NITA at a flat KES 50/head", () => {
    const summaries = [
      { id: "1", name: "A", kra_pin: "P1", cost_centre: "511", gross_salary: 100000, net_paye: 20010.35, nssf_t1: 420, nssf_t2: 1740, shif: 2750, ahl: 1500, defined_pension_ee: 5000, defined_pension_er: 10000, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0, advances: 0, net_salary: 68579.65, fringe_benefit: 0 },
      { id: "2", name: "B", kra_pin: "P2", cost_centre: "121", gross_salary: 50000, net_paye: 5000, nssf_t1: 420, nssf_t2: 1740, shif: 1375, ahl: 750, defined_pension_ee: 2500, defined_pension_er: 5000, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0, advances: 0, net_salary: 38215, fringe_benefit: 0 },
    ]

    const gl = buildGLPosting(summaries, R2024)
    expect(gl.gross_salaries).toBeCloseTo(150000, 2)
    expect(gl.nita_total).toBe(100) // 2 employees * 50
    expect(gl.net_salaries).toBeCloseTo(106794.65, 2)
  })
})

describe("buildCostCentreBreakdown", () => {
  it("groups employees by cost centre and sums per-centre totals", () => {
    const summaries = [
      { id: "1", name: "A", kra_pin: "P1", cost_centre: "511", gross_salary: 100000, net_paye: 20000, nssf_t1: 420, nssf_t2: 1740, shif: 2750, ahl: 1500, defined_pension_ee: 5000, defined_pension_er: 10000, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0, advances: 0, net_salary: 68580, fringe_benefit: 4000 },
      { id: "2", name: "B", kra_pin: "P2", cost_centre: "511", gross_salary: 50000, net_paye: 5000, nssf_t1: 420, nssf_t2: 1740, shif: 1375, ahl: 750, defined_pension_ee: 2500, defined_pension_er: 5000, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0, advances: 0, net_salary: 38215, fringe_benefit: 0 },
    ]

    const breakdown = buildCostCentreBreakdown(summaries)
    expect(breakdown).toHaveLength(1)
    expect(breakdown[0].code).toBe("511")
    expect(breakdown[0].headcount).toBe(2)
    expect(breakdown[0].gross).toBeCloseTo(150000, 2)
    // Cash is what the centre actually bears: gross less the non-cash
    // fringe benefit. This is the basis the AX journal and the finance
    // manager's workbook both use.
    expect(breakdown[0].fringe).toBeCloseTo(4000, 2)
    expect(breakdown[0].cash).toBeCloseTo(146000, 2)
  })

  it("splits fringe and cash across a shared employee's cost centres", () => {
    // A General Manager on 50/50 puts half his fringe — and half his cash
    // cost — into each centre, exactly as his gross is split.
    const summaries = [
      {
        id: "GM", name: "GM", kra_pin: "P9", cost_centre: "121",
        cost_centre_allocation: { "121": 0.5, "512": 0.5 },
        gross_salary: 600000, net_paye: 100000, nssf_t1: 420, nssf_t2: 1740,
        shif: 8250, ahl: 4500, defined_pension_ee: 20000, defined_pension_er: 40000,
        helb: 0, company_loan: 0, bank_loan: 0, sacco: 0, advances: 0,
        net_salary: 300000, fringe_benefit: 160000,
      },
    ]

    const breakdown = buildCostCentreBreakdown(summaries)
    expect(breakdown.map((b) => b.code)).toEqual(["121", "512"])
    for (const row of breakdown) {
      expect(row.gross).toBeCloseTo(300000, 2)
      expect(row.fringe).toBeCloseTo(80000, 2)
      expect(row.cash).toBeCloseTo(220000, 2)
      expect(row.headcount).toBe(1)
    }
  })
})

// ── Effective-dated rule cards ───────────────────────────────────────────────
// Every input here is a plain basic salary so each expected figure can be
// checked by hand from the card's own numbers.
function basicOnly(base_salary: number, extra: Partial<Parameters<typeof computePayroll>[0]> = {}) {
  return {
    base_salary, bonus_commission: 0, fringe_benefit: 0, transport_allowance: 0,
    arrears: 0, ot_other: 0, voluntary_pension: 0, advances: 0, helb: 0,
    company_loan: 0, bank_loan: 0, sacco: 0, ...extra,
  }
}

describe("rulesForMonth", () => {
  it("picks the latest card in force for the pay month", () => {
    expect(rulesForMonth("2024-11")).toBe(KENYA_PAYROLL_RULES_2024)
    expect(rulesForMonth("2025-06")).toBe(KENYA_PAYROLL_RULES_2025)
    expect(rulesForMonth("2026-01")).toBe(KENYA_PAYROLL_RULES_2025) // NSSF Year 4 only from Feb 2026
    expect(rulesForMonth("2026-08")).toBe(KENYA_PAYROLL_RULES_2026)
  })

  it("refuses a month it holds no rules for, rather than guessing", () => {
    expect(() => rulesForMonth("2023-12")).toThrow(/no statutory rules on file/)
    expect(() => rulesForMonth("Aug 2026")).toThrow(/YYYY-MM/)
    expect(() => rulesForMonth("2026-13")).toThrow(/YYYY-MM/)
  })
})

describe("computePayroll on later rule cards", () => {
  it("2024 baseline: NSSF is the flat 420 / 1,740, SHIF and AHL are not deductible, AHL carries 15% relief", () => {
    const r = computePayroll(basicOnly(100000), KENYA_PAYROLL_RULES_2024)
    expect(r.nssf_t1).toBe(420)
    expect(r.nssf_t2).toBe(1740)
    expect(r.taxable_pay).toBeCloseTo(100000 - 5000 - 420 - 1740, 2)
    expect(r.ahl_relief).toBeCloseTo(1500 * 0.15, 2)
  })

  it("2025 card: NSSF Year 3 limits, SHIF and AHL deducted from taxable pay, no AHL relief, cap 30,000", () => {
    const r = computePayroll(basicOnly(100000), KENYA_PAYROLL_RULES_2025)
    expect(r.nssf_t1).toBe(480)                 // 6% × 8,000
    expect(r.nssf_t2).toBe(3840)                // 6% × (72,000 − 8,000)
    expect(r.shif).toBeCloseTo(2750, 2)
    expect(r.ahl).toBeCloseTo(1500, 2)
    expect(r.taxable_pay).toBeCloseTo(100000 - 5000 - 480 - 3840 - 2750 - 1500, 2)
    expect(r.ahl_relief).toBe(0)
    // Deductibility lowers PAYE against the 2024 treatment of the same pay.
    const r2024 = computePayroll(basicOnly(100000), KENYA_PAYROLL_RULES_2024)
    expect(r.net_paye).toBeLessThan(r2024.net_paye)
  })

  it("2025 card raises the pension deductible cap from 20,000 to 30,000", () => {
    const r2024 = computePayroll(basicOnly(500000), KENYA_PAYROLL_RULES_2024)
    const r2025 = computePayroll(basicOnly(500000), KENYA_PAYROLL_RULES_2025)
    expect(r2024.defined_pension_ee).toBe(20000)   // 5% = 25,000, capped
    expect(r2025.defined_pension_ee).toBe(25000)   // under the new cap
    // The 2024 excess over the cap is redirected into deductions, not dropped —
    // so the pension money leaving the employee's pay is 25,000 on both cards.
    const pensionOut = (r: ReturnType<typeof computePayroll>) =>
      r.deductions - r.net_paye - r.nssf_t1 - r.nssf_t2 - r.shif - r.ahl
    expect(pensionOut(r2024)).toBeCloseTo(25000, 2)
    expect(pensionOut(r2025)).toBeCloseTo(25000, 2)
  })

  it("2026 card: NSSF Year 4 limits, computed from earnings for anyone under the upper limit", () => {
    const low = computePayroll(basicOnly(50000), KENYA_PAYROLL_RULES_2026)
    expect(low.nssf_t1).toBe(540)                 // 6% × 9,000
    expect(low.nssf_t2).toBeCloseTo(2460, 2)      // 6% × (50,000 − 9,000)
    const high = computePayroll(basicOnly(200000), KENYA_PAYROLL_RULES_2026)
    expect(high.nssf_t2).toBeCloseTo(5940, 2)     // 6% × (108,000 − 9,000)
  })

  it("a per-employee NSSF Tier II override still wins on every card", () => {
    const r = computePayroll(basicOnly(50000, { nssf_t2_override: 1000 }), KENYA_PAYROLL_RULES_2026)
    expect(r.nssf_t2).toBe(1000)
  })

  it("an employee outside the pension scheme costs the employer nothing on every card", () => {
    for (const card of [KENYA_PAYROLL_RULES_2024, KENYA_PAYROLL_RULES_2025, KENYA_PAYROLL_RULES_2026]) {
      const r = computePayroll(basicOnly(80000, { pension_rate_override: 0 }), card)
      expect(r.defined_pension_ee).toBe(0)
      expect(r.defined_pension_er).toBe(0)
    }
    // …while a non-standard but non-zero rate keeps the employer's 10%.
    const partial = computePayroll(basicOnly(80000, { pension_rate_override: 0.03 }), KENYA_PAYROLL_RULES_2024)
    expect(partial.defined_pension_ee).toBeCloseTo(2400, 2)
    expect(partial.defined_pension_er).toBeCloseTo(8000, 2)
  })
})
