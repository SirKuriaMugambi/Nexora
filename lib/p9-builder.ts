/**
 * Kenyan P9 tax deduction card generation.
 *
 * A P9 (KRA form P9A) is the annual per-employee summary of pay and PAYE
 * that every employer must issue so employees can file their individual
 * returns. One card per employee, one row per month, with annual totals.
 *
 * Column mapping from our payroll register (see lib/payroll-engine.ts for
 * how each figure is computed and verified):
 *   Basic Pay        -> basic_salary
 *   Benefits non-cash-> fringe_benefit
 *   Gross Pay        -> gross_salary
 *   Retirement (E)   -> defined_pension_ee + nssf_t1 + nssf_t2 (the actual
 *                       pre-tax retirement deductions; this matches how
 *                       chargeable pay is derived: gross − E = taxable)
 *   Chargeable Pay   -> taxable_pay
 *   Tax Charged      -> gross_paye
 *   Reliefs          -> personal_relief + nhif_relief + ahl_relief
 *   PAYE Deducted    -> net_paye
 *
 * The layout follows the standard P9A column structure but is generated
 * from this system's verified figures — confirm against KRA's current P9A
 * template before issuing to employees for an actual filing season.
 */

import { jsPDF } from "jspdf"
import JSZip from "jszip"

export interface P9EntryRow {
  employee_id: string
  month: string // "YYYY-MM"
  basic_salary: number
  fringe_benefit: number
  gross_salary: number
  nssf_t1: number
  nssf_t2: number
  defined_pension_ee: number
  taxable_pay: number
  gross_paye: number
  personal_relief: number
  nhif_relief: number
  ahl_relief: number
  net_paye: number
}

export interface P9MonthlyFigures {
  month: string
  basic: number
  benefits: number
  gross: number
  retirement: number
  chargeable: number
  taxCharged: number
  reliefs: number
  paye: number
}

export interface P9Card {
  employeeId: string
  name: string
  kraPin: string
  year: string
  rows: P9MonthlyFigures[]
  totals: Omit<P9MonthlyFigures, "month">
}

const round2 = (n: number) => +n.toFixed(2)

export function buildP9Cards(
  year: string,
  employees: Array<{ id: string; name: string; kra_pin: string }>,
  entries: P9EntryRow[],
): P9Card[] {
  const byEmployee = new Map<string, P9EntryRow[]>()
  for (const entry of entries) {
    if (!entry.month.startsWith(`${year}-`)) continue
    const list = byEmployee.get(entry.employee_id) ?? []
    list.push(entry)
    byEmployee.set(entry.employee_id, list)
  }

  const cards: P9Card[] = []
  for (const employee of employees) {
    const employeeEntries = byEmployee.get(employee.id)
    if (!employeeEntries || employeeEntries.length === 0) continue

    const rows = employeeEntries
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((e) => ({
        month: e.month,
        basic: round2(e.basic_salary),
        benefits: round2(e.fringe_benefit),
        gross: round2(e.gross_salary),
        retirement: round2(e.defined_pension_ee + e.nssf_t1 + e.nssf_t2),
        chargeable: round2(e.taxable_pay),
        taxCharged: round2(e.gross_paye),
        reliefs: round2(e.personal_relief + e.nhif_relief + e.ahl_relief),
        paye: round2(e.net_paye),
      }))

    const totals = rows.reduce(
      (acc, row) => ({
        basic: round2(acc.basic + row.basic),
        benefits: round2(acc.benefits + row.benefits),
        gross: round2(acc.gross + row.gross),
        retirement: round2(acc.retirement + row.retirement),
        chargeable: round2(acc.chargeable + row.chargeable),
        taxCharged: round2(acc.taxCharged + row.taxCharged),
        reliefs: round2(acc.reliefs + row.reliefs),
        paye: round2(acc.paye + row.paye),
      }),
      { basic: 0, benefits: 0, gross: 0, retirement: 0, chargeable: 0, taxCharged: 0, reliefs: 0, paye: 0 },
    )

    cards.push({ employeeId: employee.id, name: employee.name, kraPin: employee.kra_pin, year, rows, totals })
  }

  return cards.sort((a, b) => a.employeeId.localeCompare(b.employeeId))
}

// ── PDF rendering ────────────────────────────────────────────────────────────

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const LEFT = 36
// Column x-positions (landscape A4 is 842pt wide). Month label column, then
// eight right-aligned amount columns.
const AMOUNT_COLS: Array<{ label: string; x: number }> = [
  { label: "Basic Pay", x: 218 },
  { label: "Benefits (Non-Cash)", x: 304 },
  { label: "Gross Pay", x: 390 },
  { label: "Pension + NSSF (E)", x: 476 },
  { label: "Chargeable Pay", x: 562 },
  { label: "Tax Charged", x: 648 },
  { label: "Reliefs", x: 720 },
  { label: "PAYE Deducted", x: 806 },
]

function fmtAmount(n: number): string {
  return n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function drawP9Page(doc: jsPDF, card: P9Card) {
  let y = 44

  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.text("CHRYSAL AFRICA LTD", LEFT, y)
  doc.setFontSize(10)
  y += 16
  doc.text(`TAX DEDUCTION CARD — YEAR ${card.year} (P9A format)`, LEFT, y)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  y += 18

  doc.text(`Employee: ${card.name}`, LEFT, y)
  doc.text(`Staff No: ${card.employeeId}`, 360, y)
  doc.text(`Employee KRA PIN: ${card.kraPin || "—"}`, 520, y)
  y += 12
  doc.text("Employer: Chrysal Africa Ltd", LEFT, y)
  y += 20

  // Table header
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.text("Month", LEFT, y)
  for (const col of AMOUNT_COLS) {
    doc.text(col.label, col.x, y, { align: "right", maxWidth: 82 })
  }
  y += 8
  doc.line(LEFT, y, 806, y)
  y += 12
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)

  const rowByMonth = new Map(card.rows.map((row) => [row.month, row]))
  for (let m = 1; m <= 12; m++) {
    const key = `${card.year}-${String(m).padStart(2, "0")}`
    const row = rowByMonth.get(key)
    doc.text(MONTH_LABELS[m - 1], LEFT, y)
    if (row) {
      const values = [row.basic, row.benefits, row.gross, row.retirement, row.chargeable, row.taxCharged, row.reliefs, row.paye]
      values.forEach((value, i) => doc.text(fmtAmount(value), AMOUNT_COLS[i].x, y, { align: "right" }))
    } else {
      AMOUNT_COLS.forEach((col) => doc.text("—", col.x, y, { align: "right" }))
    }
    y += 15
  }

  y += 2
  doc.line(LEFT, y - 10, 806, y - 10)
  doc.setFont("helvetica", "bold")
  doc.text("TOTALS", LEFT, y)
  const t = card.totals
  const totalValues = [t.basic, t.benefits, t.gross, t.retirement, t.chargeable, t.taxCharged, t.reliefs, t.paye]
  totalValues.forEach((value, i) => doc.text(fmtAmount(value), AMOUNT_COLS[i].x, y, { align: "right" }))
  doc.setFont("helvetica", "normal")

  y += 24
  doc.setFontSize(7)
  doc.setTextColor(110, 110, 110)
  doc.text(
    "Retirement (E) = defined pension contribution + NSSF Tier I & II. Reliefs = personal relief + SHIF/NHIF relief + affordable housing relief.",
    LEFT, y,
  )
  y += 10
  doc.text(
    "Generated by Nexora from the approved payroll register. Verify against KRA's current P9A template before issuing for a filing season.",
    LEFT, y,
  )
  doc.setTextColor(0, 0, 0)
}

/**
 * One combined PDF, one page per employee — for Tony's own filing/archive
 * copy, or for printing a batch. NOT what an individual employee should
 * receive: a P9 is a personal tax document they need for their own annual
 * return, so handing them 45 other people's pages along with theirs is
 * inconvenient AND a real privacy problem (every employee would be able to
 * see every other employee's pay). Use generateIndividualP9PDF / the ZIP /
 * email path below for anything employee-facing.
 */
export function generateP9PDF(cards: P9Card[]): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" })
  cards.forEach((card, i) => {
    if (i > 0) doc.addPage()
    drawP9Page(doc, card)
  })
  return doc.output("blob")
}

/** One single-page PDF per employee — what actually gets emailed/zipped. */
export function generateIndividualP9PDF(card: P9Card): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" })
  drawP9Page(doc, card)
  return doc.output("blob")
}

/** Individual per-employee PDFs packaged into one ZIP for a single download. */
export async function generateP9ZIP(cards: P9Card[]): Promise<Blob> {
  const zip = new JSZip()
  for (const card of cards) {
    const blob = generateIndividualP9PDF(card)
    zip.file(`P9-${card.employeeId}-${card.year}.pdf`, await blob.arrayBuffer())
  }
  return zip.generateAsync({ type: "blob" })
}
