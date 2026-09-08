import { computePayroll, buildGLPosting, buildCostCentreBreakdown } from "@/lib/payroll-engine"

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
    })

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
    })

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
    })

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
    })

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
    })

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
    })

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
    })

    expect(result.gross_paye).toBeCloseTo(115232.80, 2)
    expect(result.defined_pension_ee).toBe(0)
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
    })

    expect(result.gross_paye).toBeCloseTo(8923.41, 2)
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
    })

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
    })
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
    })

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
    })

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
    })

    expect(result.personal_relief).toBe(5000)
  })
})

describe("buildGLPosting", () => {
  it("sums gross, statutory, and net totals across employees, with NITA at a flat KES 50/head", () => {
    const summaries = [
      { id: "1", name: "A", kra_pin: "P1", cost_centre: "511", gross_salary: 100000, net_paye: 20010.35, nssf_t1: 420, nssf_t2: 1740, shif: 2750, ahl: 1500, defined_pension_ee: 5000, defined_pension_er: 10000, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0, advances: 0, net_salary: 68579.65, fringe_benefit: 0 },
      { id: "2", name: "B", kra_pin: "P2", cost_centre: "121", gross_salary: 50000, net_paye: 5000, nssf_t1: 420, nssf_t2: 1740, shif: 1375, ahl: 750, defined_pension_ee: 2500, defined_pension_er: 5000, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0, advances: 0, net_salary: 38215, fringe_benefit: 0 },
    ]

    const gl = buildGLPosting(summaries)
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
