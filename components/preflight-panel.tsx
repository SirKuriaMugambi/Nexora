"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  PAYROLL_VALIDATION_CAUSE_LABELS,
  fixLinkFor,
  type PayrollValidationCode,
  type PayrollValidationIssue,
} from "@/lib/payroll-validation"
import { FilterChips } from "@/components/filter-chips"

/** Cause chips for a set of issues, most frequent first. Shared with Employee Master. */
export function issueCauseOptions(issues: PayrollValidationIssue[]) {
  const counts = new Map<PayrollValidationCode, number>()
  for (const issue of issues) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, label: PAYROLL_VALIDATION_CAUSE_LABELS[key], count }))
}

// Pre-flight results. The cause chips are filters: press "no email" and the
// list becomes exactly those employees, so the finance manager can see every
// affected person for one cause without wading through the others. With no
// filter it previews the first few rows and offers "Show all".
export function PreflightPanel({
  issues,
  severity,
  defaultFilter = null,
}: {
  issues: PayrollValidationIssue[]
  severity: "error" | "warning"
  /** Initial cause filter — mainly for tests and deep links. */
  defaultFilter?: PayrollValidationCode | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState<PayrollValidationCode | null>(defaultFilter)
  const isError = severity === "error"
  const previewCount = isError ? 8 : 5

  const causes = useMemo(() => issueCauseOptions(issues), [issues])
  const filtered = useMemo(
    () => (filter ? issues.filter((i) => i.code === filter) : issues),
    [issues, filter],
  )

  if (issues.length === 0) return null

  // A chosen cause always shows its full list — that is the point of choosing it.
  const showAll = expanded || filter !== null
  const shown = showAll ? filtered : filtered.slice(0, previewCount)
  const hidden = filtered.length - shown.length
  const noun = isError ? "blocking issue" : "warning"

  const tone = isError
    ? { box: "border-rose-200 bg-rose-50/40 dark:bg-rose-950/20 dark:border-rose-900", head: "text-rose-600 dark:text-rose-400", row: "text-rose-700 dark:text-rose-400", link: "text-rose-600 dark:text-rose-400" }
    : { box: "border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-900", head: "text-amber-600 dark:text-amber-400", row: "text-amber-700 dark:text-amber-400", link: "text-amber-600 dark:text-amber-400" }

  return (
    <div className={`p-3 border text-[11px] space-y-1.5 ${tone.box}`}>
      <p className={`font-bold font-mono uppercase text-[10px] tracking-wider ${tone.head}`}>
        {issues.length} {noun}{issues.length > 1 ? "s" : ""} — {isError
          ? "Run Payroll is disabled until these are fixed in Employee Master"
          : "the run can proceed, but some outputs will skip these employees"}
      </p>
      <FilterChips
        options={causes}
        active={filter}
        onChange={setFilter}
        total={issues.length}
        tone={isError ? "rose" : "amber"}
      />
      {filter && (
        <p className={`font-mono text-[10px] ${tone.link}`}>
          Showing {filtered.length} of {issues.length} — {PAYROLL_VALIDATION_CAUSE_LABELS[filter]}
        </p>
      )}
      <div className={showAll ? "max-h-80 overflow-y-auto pr-1 space-y-1" : "space-y-1"}>
        {shown.map((issue, i) => (
          <p key={`${issue.employeeId}-${issue.code}-${i}`} className={tone.row}>
            <span className="font-mono font-bold">{issue.employeeId}</span> ({issue.name}): {issue.message}{" "}
            <Link
              href={fixLinkFor(issue)}
              className={`font-mono text-[10px] uppercase tracking-wider underline underline-offset-2 whitespace-nowrap hover:opacity-80 ${tone.link}`}
              title="Opens this employee in Employee Master with the field to fix selected"
            >
              Fix →
            </Link>
          </p>
        ))}
      </div>
      {!filter && (hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`font-mono text-[10px] uppercase tracking-wider underline underline-offset-2 hover:opacity-80 ${tone.link}`}
        >
          {expanded ? "Show fewer" : `Show all ${issues.length} ${noun}s`}
        </button>
      )}
      {!filter && !expanded && hidden > 0 && (
        <span className={`ml-2 ${tone.link}`}>…{hidden} more not shown. Fix these in Employee Master.</span>
      )}
    </div>
  )
}
