"use client"

import { useMemo, useState } from "react"
import {
  PAYROLL_VALIDATION_CAUSE_LABELS,
  type PayrollValidationCode,
  type PayrollValidationIssue,
} from "@/lib/payroll-validation"

// Pre-flight results. Collapsed it shows a cause summary and the first few
// rows; "Show all" lists every employee with the reason, so the finance
// manager can see exactly what will be skipped or blocked and why, rather
// than "…and 45 more". The full list scrolls inside the panel.
export function PreflightPanel({ issues, severity }: { issues: PayrollValidationIssue[]; severity: "error" | "warning" }) {
  const [expanded, setExpanded] = useState(false)
  const isError = severity === "error"
  const previewCount = isError ? 8 : 5

  const causes = useMemo(() => {
    const counts = new Map<PayrollValidationCode, number>()
    for (const issue of issues) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [issues])

  if (issues.length === 0) return null
  const shown = expanded ? issues : issues.slice(0, previewCount)
  const hidden = issues.length - shown.length
  const noun = isError ? "blocking issue" : "warning"

  const tone = isError
    ? { box: "border-rose-200 bg-rose-50/40 dark:bg-rose-950/20 dark:border-rose-900", head: "text-rose-600 dark:text-rose-400", row: "text-rose-700 dark:text-rose-400", link: "text-rose-600 dark:text-rose-400", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" }
    : { box: "border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-900", head: "text-amber-600 dark:text-amber-400", row: "text-amber-700 dark:text-amber-400", link: "text-amber-600 dark:text-amber-400", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" }

  return (
    <div className={`p-3 border text-[11px] space-y-1.5 ${tone.box}`}>
      <p className={`font-bold font-mono uppercase text-[10px] tracking-wider ${tone.head}`}>
        {issues.length} {noun}{issues.length > 1 ? "s" : ""} — {isError
          ? "Run Payroll is disabled until these are fixed in Employee Master"
          : "the run can proceed, but some outputs will skip these employees"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {causes.map(([code, count]) => (
          <span key={code} className={`font-mono text-[10px] px-1.5 py-0.5 ${tone.chip}`}>
            {count} × {PAYROLL_VALIDATION_CAUSE_LABELS[code]}
          </span>
        ))}
      </div>
      <div className={expanded ? "max-h-80 overflow-y-auto pr-1 space-y-1" : "space-y-1"}>
        {shown.map((issue, i) => (
          <p key={`${issue.employeeId}-${issue.code}-${i}`} className={tone.row}>
            <span className="font-mono font-bold">{issue.employeeId}</span> ({issue.name}): {issue.message}
          </p>
        ))}
      </div>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`font-mono text-[10px] uppercase tracking-wider underline underline-offset-2 hover:opacity-80 ${tone.link}`}
        >
          {expanded ? "Show fewer" : `Show all ${issues.length} ${noun}s`}
        </button>
      )}
      {!expanded && hidden > 0 && (
        <span className={`ml-2 ${tone.link}`}>…{hidden} more not shown. Fix these in Employee Master.</span>
      )}
    </div>
  )
}
