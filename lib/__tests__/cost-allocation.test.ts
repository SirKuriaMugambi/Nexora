import {
  buildEmployeeDimension,
  allocateAcrossSplits,
  groupByDimension,
  getEmployeeCostCentreSplits,
  allocateEmployeeAmount,
  CostAllocationError,
} from "@/lib/cost-allocation"

describe("buildEmployeeDimension", () => {
  it("maps an employee's department/cost_centre straight to an AxDimension", () => {
    const dimension = buildEmployeeDimension({ id: "1", department: "Finance", cost_centre: "121" })
    expect(dimension).toEqual({ department: "Finance", costCentre: "121" })
  })
})

describe("allocateAcrossSplits", () => {
  it("splits an amount proportionally across multiple cost centres", () => {
    const result = allocateAcrossSplits(100000, [
      { department: "OPS", costCentre: "511", percentage: 60 },
      { department: "FIN", costCentre: "121", percentage: 40 },
    ])

    expect(result).toHaveLength(2)
    expect(result[0].amount).toBeCloseTo(60000, 2)
    expect(result[1].amount).toBeCloseTo(40000, 2)
  })

  it("makes the allocated amounts sum EXACTLY to the input, absorbing rounding remainder into the last split", () => {
    const result = allocateAcrossSplits(100, [
      { department: "A", costCentre: "1", percentage: 33.33 },
      { department: "B", costCentre: "2", percentage: 33.33 },
      { department: "C", costCentre: "3", percentage: 33.34 },
    ])

    const total = result.reduce((sum, r) => sum + r.amount, 0)
    expect(+total.toFixed(2)).toBe(100)
  })

  it("throws CostAllocationError when splits don't sum to 100%", () => {
    expect(() =>
      allocateAcrossSplits(100000, [
        { department: "OPS", costCentre: "511", percentage: 60 },
        { department: "FIN", costCentre: "121", percentage: 30 },
      ]),
    ).toThrow(CostAllocationError)
  })

  it("throws CostAllocationError when no splits are given", () => {
    expect(() => allocateAcrossSplits(100000, [])).toThrow(CostAllocationError)
  })
})

describe("getEmployeeCostCentreSplits", () => {
  it("falls back to a single 100% split on cost_centre when no allocation is set", () => {
    const splits = getEmployeeCostCentreSplits({ id: "1000", department: "Production", cost_centre: "512" })
    expect(splits).toEqual([{ department: "Production", costCentre: "512", percentage: 100 }])
  })

  it("falls back the same way for null and empty-object allocations, not just absent", () => {
    for (const allocation of [null, {}]) {
      const splits = getEmployeeCostCentreSplits({
        id: "1000", department: "Production", cost_centre: "512", cost_centre_allocation: allocation,
      })
      expect(splits).toEqual([{ department: "Production", costCentre: "512", percentage: 100 }])
    }
  })

  it("converts a real allocation (0-1 fractional shares) to percentage splits", () => {
    const splits = getEmployeeCostCentreSplits({
      id: "1005", department: "Production", cost_centre: "121",
      cost_centre_allocation: { "121": 0.5, "512": 0.5 },
    })
    expect(splits).toHaveLength(2)
    expect(splits).toEqual(
      expect.arrayContaining([
        { department: "Production", costCentre: "121", percentage: 50 },
        { department: "Production", costCentre: "512", percentage: 50 },
      ]),
    )
  })
})

describe("allocateEmployeeAmount", () => {
  it("splits a real employee's amount exactly 50/50 across two cost centres — the actual General Manager case", () => {
    const result = allocateEmployeeAmount(
      { id: "1005", department: "Production", cost_centre: "121", cost_centre_allocation: { "121": 0.5, "512": 0.5 } },
      440382.84,
    )
    expect(result).toHaveLength(2)
    const cc121 = result.find((r) => r.dimension.costCentre === "121")!
    const cc512 = result.find((r) => r.dimension.costCentre === "512")!
    expect(cc121.amount).toBeCloseTo(220191.42, 2)
    expect(cc512.amount).toBeCloseTo(220191.42, 2)
    expect(cc121.amount + cc512.amount).toBeCloseTo(440382.84, 2)
  })

  it("returns the full amount on the single cost centre for an unsplit employee", () => {
    const result = allocateEmployeeAmount({ id: "1000", department: "Production", cost_centre: "511" }, 398051.75)
    expect(result).toEqual([{ dimension: { department: "Production", costCentre: "511" }, amount: 398051.75 }])
  })
})

describe("groupByDimension", () => {
  it("groups and sums amounts by department+cost centre", () => {
    const grouped = groupByDimension([
      { employee: { id: "1", department: "OPS", cost_centre: "511" }, amount: 100 },
      { employee: { id: "2", department: "OPS", cost_centre: "511" }, amount: 200 },
      { employee: { id: "3", department: "FIN", cost_centre: "121" }, amount: 50 },
    ])

    expect(grouped).toHaveLength(2)
    const production = grouped.find((g) => g.costCentre === "511")
    expect(production?.totalAmount).toBe(300)
    expect(production?.employeeCount).toBe(2)
  })
})
