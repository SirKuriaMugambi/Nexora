/**
 * Server-renders the panel (no DOM environment in this repo) to prove the
 * collapsed view shows the cause summary, the preview rows and the
 * "show all" control — the parts the finance manager actually reads.
 */
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PreflightPanel } from "@/components/preflight-panel"
import type { PayrollValidationIssue } from "@/lib/payroll-validation"

const noEmail = (id: string): PayrollValidationIssue => ({
  employeeId: id, name: `Employee ${id}`, severity: "warning", code: "missing_email",
  message: "No email on file — payslip emailing will skip this employee.",
})
const dup = (id: string, other: string): PayrollValidationIssue => ({
  employeeId: id, name: `Employee ${id}`, severity: "warning", code: "duplicate_emp_code",
  message: `EMP code EMP011 is also assigned to ${other} — each employee needs their own bank file reference.`,
})

describe("PreflightPanel", () => {
  const issues = [
    dup("1011", "1012"), dup("1012", "1011"),
    ...Array.from({ length: 46 }, (_, i) => noEmail(String(1000 + i))),
  ]

  it("summarises causes with counts, previews the first rows and offers to show all", () => {
    const html = renderToStaticMarkup(<PreflightPanel issues={issues} severity="warning" />)
    expect(html).toContain("48 warnings")
    expect(html).toContain("46 × no email")
    expect(html).toContain("2 × EMP code shared with another employee")
    // first five rows visible, the rest behind the control
    expect(html).toContain("1011")
    expect(html).toContain("is also assigned to 1012")
    expect(html).toContain("Show all 48 warnings")
    expect(html).toContain("43 more not shown")
    expect(html).not.toContain("Employee 1045")
  })

  it("renders nothing when there are no issues", () => {
    expect(renderToStaticMarkup(<PreflightPanel issues={[]} severity="error" />)).toBe("")
  })

  it("uses the blocking wording and preview size for errors", () => {
    const errors = issues.slice(0, 10).map((i) => ({ ...i, severity: "error" as const, code: "missing_kra_pin" as const }))
    const html = renderToStaticMarkup(<PreflightPanel issues={errors} severity="error" />)
    expect(html).toContain("10 blocking issues")
    expect(html).toContain("Run Payroll is disabled")
    expect(html).toContain("10 × no KRA PIN")
    expect(html).toContain("2 more not shown")   // 8 previewed for errors
  })
})

describe("PreflightPanel cause filter", () => {
  const issues = [
    dup("1011", "1012"), dup("1012", "1011"),
    ...Array.from({ length: 46 }, (_, i) => noEmail(String(1000 + i))),
  ]

  it("renders the cause chips as pressable buttons with All selected by default", () => {
    const html = renderToStaticMarkup(<PreflightPanel issues={issues} severity="warning" />)
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>All \(48\)<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>46 × no email<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>2 × EMP code shared with another employee<\/button>/)
  })

  it("with a cause selected, lists every employee for that cause and nothing else", () => {
    const html = renderToStaticMarkup(
      <PreflightPanel issues={issues} severity="warning" defaultFilter="duplicate_emp_code" />,
    )
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>2 × EMP code shared with another employee<\/button>/)
    expect(html).toContain("Showing 2 of 48 — EMP code shared with another employee")
    expect(html).toContain("is also assigned to 1012")
    expect(html).toContain("is also assigned to 1011")
    expect(html).not.toContain("No email on file")
    // the preview/show-all controls belong to the unfiltered view only
    expect(html).not.toContain("Show all")
    expect(html).not.toContain("more not shown")
  })

  it("a selected cause shows its full list even when it is long", () => {
    const html = renderToStaticMarkup(
      <PreflightPanel issues={issues} severity="warning" defaultFilter="missing_email" />,
    )
    expect(html).toContain("Showing 46 of 48 — no email")
    expect(html).toContain("Employee 1000")
    expect(html).toContain("Employee 1045")
    expect(html).not.toContain("is also assigned")
  })
})
