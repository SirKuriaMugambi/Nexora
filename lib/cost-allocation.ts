/**
 * Maps payroll amounts to Dynamics AX financial dimensions (department +
 * cost centre). Most employees carry exactly one cost_centre — that's what
 * `buildEmployeeDimension` covers. A shared-services employee (e.g. a
 * General Manager whose cost splits across two centres) instead carries a
 * `cost_centre_allocation` JSONB map of costCentre -> fractional share
 * (0–1, summing to 1) on public.employees; `getEmployeeCostCentreSplits` and
 * `allocateEmployeeAmount` read that and fall back to the single-centre case
 * when it's absent, so every caller can use `allocateEmployeeAmount`
 * unconditionally rather than branching on whether an employee happens to
 * have a split.
 */

export interface AxDimension {
  department: string
  costCentre: string
}

export interface CostAllocationSplit extends AxDimension {
  /** 0–100. All splits for one employee/amount must sum to exactly 100. */
  percentage: number
}

export interface AllocatedAmount {
  dimension: AxDimension
  amount: number
}

export interface EmployeeForAllocation {
  id: string
  department: string
  cost_centre: string
  /** costCentre -> fractional share (0–1). Absent/null/empty = single cost_centre, 100%. */
  cost_centre_allocation?: Record<string, number> | null
}

/** The single-cost-centre case: today's default data shape, one dimension per employee. */
export function buildEmployeeDimension(employee: EmployeeForAllocation): AxDimension {
  return {
    department: employee.department,
    costCentre: employee.cost_centre,
  }
}

/**
 * Resolves an employee's cost-centre splits as CostAllocationSplit[] ready
 * for allocateAcrossSplits — from cost_centre_allocation if it's a real,
 * non-empty map, otherwise a single 100% split on their primary cost_centre.
 * Department is the employee's single department field for every split
 * line; only cost centre varies per split in the data we have.
 */
export function getEmployeeCostCentreSplits(employee: EmployeeForAllocation): CostAllocationSplit[] {
  const allocation = employee.cost_centre_allocation
  const entries = allocation ? Object.entries(allocation).filter(([, share]) => share > 0) : []

  if (entries.length === 0) {
    return [{ department: employee.department, costCentre: employee.cost_centre, percentage: 100 }]
  }

  return entries.map(([costCentre, share]) => ({
    department: employee.department,
    costCentre,
    percentage: share * 100,
  }))
}

/**
 * Splits one amount (e.g. an employee's gross salary) across their real
 * cost-centre allocation. This is what journal-builder.ts and the on-screen
 * cost-centre breakdown should call instead of assuming one dimension per
 * employee — it's a no-op wrapper around allocateAcrossSplits for the
 * (common) single-centre case, and does the real split otherwise.
 */
export function allocateEmployeeAmount(employee: EmployeeForAllocation, amount: number): AllocatedAmount[] {
  return allocateAcrossSplits(amount, getEmployeeCostCentreSplits(employee))
}

export class CostAllocationError extends Error {}

/**
 * Splits a monetary amount across multiple cost-centre dimensions. Throws
 * CostAllocationError if the splits don't sum to 100% (within a small
 * floating-point tolerance) — a silent misallocation would misstate cost
 * centre P&L, so this fails loudly rather than allocating anyway.
 */
export function allocateAcrossSplits(amount: number, splits: CostAllocationSplit[]): AllocatedAmount[] {
  if (splits.length === 0) {
    throw new CostAllocationError("At least one cost allocation split is required.")
  }

  const totalPercentage = splits.reduce((sum, s) => sum + s.percentage, 0)
  if (Math.abs(totalPercentage - 100) > 0.01) {
    throw new CostAllocationError(
      `Cost allocation splits must sum to 100% — got ${totalPercentage}%.`,
    )
  }

  // Round every split's share to 2dp, then push any rounding remainder onto
  // the last line so the allocated amounts sum EXACTLY to the input amount
  // (required for the journal builder's debit=credit check to hold).
  const rounded = splits.map((split) => ({
    dimension: { department: split.department, costCentre: split.costCentre },
    amount: +((amount * split.percentage) / 100).toFixed(2),
  }))

  const roundedTotal = rounded.reduce((sum, r) => sum + r.amount, 0)
  const remainder = +(amount - roundedTotal).toFixed(2)
  if (remainder !== 0 && rounded.length > 0) {
    rounded[rounded.length - 1].amount = +(rounded[rounded.length - 1].amount + remainder).toFixed(2)
  }

  return rounded
}

export interface CostCentreDimensionTotal extends AxDimension {
  totalAmount: number
  employeeCount: number
}

/**
 * Groups a list of (employee, amount) pairs by their AX dimension — the
 * building block for per-cost-centre journal lines (each cost centre gets
 * its own debit line rather than one lump-sum company-wide line).
 */
export function groupByDimension(
  entries: Array<{ employee: EmployeeForAllocation; amount: number }>,
): CostCentreDimensionTotal[] {
  const map = new Map<string, CostCentreDimensionTotal>()

  for (const { employee, amount } of entries) {
    const dimension = buildEmployeeDimension(employee)
    const key = `${dimension.department}::${dimension.costCentre}`
    const existing = map.get(key)
    if (existing) {
      existing.totalAmount = +(existing.totalAmount + amount).toFixed(2)
      existing.employeeCount += 1
    } else {
      map.set(key, { ...dimension, totalAmount: +amount.toFixed(2), employeeCount: 1 })
    }
  }

  return Array.from(map.values()).sort((a, b) => a.costCentre.localeCompare(b.costCentre))
}
