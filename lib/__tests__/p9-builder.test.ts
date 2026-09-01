import { buildP9Cards, type P9EntryRow } from "@/lib/p9-builder"

const entry = (overrides: Partial<P9EntryRow>): P9EntryRow => ({
  employee_id: "1000",
  month: "2026-08",
  basic_salary: 100000,
  fringe_benefit: 1500,
  gross_salary: 101500,
  nssf_t1: 420,
  nssf_t2: 1740,
  defined_pension_ee: 5000,
  taxable_pay: 94340,
  gross_paye: 20000,
  personal_relief: 2400,
  nhif_relief: 0,
  ahl_relief: 225,
  net_paye: 17375,
  ...overrides,
})

describe("buildP9Cards", () => {
  it("builds one card per employee with data, sorted by staff number", () => {
    const cards = buildP9Cards(
      "2026",
      [
        { id: "1001", name: "B", kra_pin: "A2" },
        { id: "1000", name: "A", kra_pin: "A1" },
        { id: "1002", name: "C (no data)", kra_pin: "A3" },
      ],
      [entry({ employee_id: "1001" }), entry({ employee_id: "1000" })],
    )
    expect(cards.map((c) => c.employeeId)).toEqual(["1000", "1001"])
  })

  it("sums monthly rows into annual totals", () => {
    const cards = buildP9Cards(
      "2026",
      [{ id: "1000", name: "A", kra_pin: "A1" }],
      [
        entry({ month: "2026-08", basic_salary: 100000, net_paye: 17375 }),
        entry({ month: "2026-09", basic_salary: 100000, net_paye: 17375 }),
      ],
    )
    expect(cards[0].rows).toHaveLength(2)
    expect(cards[0].totals.basic).toBe(200000)
    expect(cards[0].totals.paye).toBe(34750)
    // Retirement column combines pension + both NSSF tiers.
    expect(cards[0].rows[0].retirement).toBe(5000 + 420 + 1740)
  })

  it("ignores entries from other years", () => {
    const cards = buildP9Cards(
      "2026",
      [{ id: "1000", name: "A", kra_pin: "A1" }],
      [entry({ month: "2025-12" })],
    )
    expect(cards).toHaveLength(0)
  })

  it("combines personal, NHIF and AHL reliefs into the reliefs column", () => {
    const cards = buildP9Cards(
      "2026",
      [{ id: "1000", name: "A", kra_pin: "A1" }],
      [entry({ personal_relief: 2400, nhif_relief: 100, ahl_relief: 225 })],
    )
    expect(cards[0].rows[0].reliefs).toBe(2725)
  })
})
