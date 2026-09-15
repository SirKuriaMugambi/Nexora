import type { Employee } from "@/lib/seeds"

// The per-employee statutory overrides (see lib/payroll-engine.ts header),
// each with the words the finance manager should read under the name.
export type ExceptionKind =
  | "pension_rate_override" | "paye_band_flat_deduction" | "nssf_t2_override"
  | "personal_relief_override" | "ahl_relief_override"

const fmtKes = (v: number) => v.toLocaleString("en-KE", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })

export const EXCEPTION_KINDS: Array<{ key: ExceptionKind; label: string; isSet: (e: Employee) => boolean; detail: (v: number) => string }> = [
  {
    key: "pension_rate_override", label: "pension rate override",
    isSet: (e) => e.pension_rate_override != null,
    detail: (v) => v === 0
      ? "Employee pension 0% — outside the scheme, so the company's 10% is nil too"
      : `Employee pension ${fmtKes(v * 100)}% instead of the standard 5%`,
  },
  {
    key: "paye_band_flat_deduction", label: "PAYE band flat deduction",
    isSet: (e) => e.paye_band_flat_deduction != null,
    detail: (v) => v === 0
      ? "PAYE bands computed on raw gross, with no deduction"
      : `PAYE bands computed on gross − KES ${fmtKes(v)}, not on taxable pay`,
  },
  {
    key: "nssf_t2_override", label: "NSSF Tier II override",
    isSet: (e) => Boolean(e.nssf_t2_override),
    detail: (v) => `NSSF Tier II fixed at KES ${fmtKes(v)} instead of the standard amount`,
  },
  {
    key: "personal_relief_override", label: "personal relief override",
    isSet: (e) => Boolean(e.personal_relief_override),
    detail: (v) => `Personal relief KES ${fmtKes(v)} instead of the standard 2,400`,
  },
  {
    key: "ahl_relief_override", label: "housing levy relief override",
    isSet: (e) => e.ahl_relief_override != null,
    detail: (v) => `Housing levy relief fixed at KES ${fmtKes(v)}`,
  },
]

// Every exception an employee carries, in words. Empty for a standard employee.
export function exceptionDetails(e: Employee, only?: ExceptionKind): string[] {
  return EXCEPTION_KINDS
    .filter((k) => (!only || k.key === only) && k.isSet(e))
    .map((k) => k.detail(Number(e[k.key])))
}

// An employee carrying any per-employee statutory override.
export const hasException = (e: Employee) => EXCEPTION_KINDS.some((k) => k.isSet(e))

