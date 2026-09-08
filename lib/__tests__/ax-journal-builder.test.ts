import { computePayroll, type PayrollInputs } from "@/lib/payroll-engine"
import { AX_JOURNAL_ACCOUNTS } from "@/lib/gl-accounts-config"
import {
  axJournalToSheet,
  axJournalToXlsx,
  axPeriodLabel,
  buildAxPayrollJournal,
  pensionExcessOverCap,
  type AxJournalEmployeeInput,
  type AxJournalEntry,
} from "@/lib/ax-journal-builder"
import * as XLSX from "xlsx"

const NITA = 50
const OPTIONS = { voucher: "SAL0000138", postingDate: new Date(2026, 7, 28), nitaFlatPerEmployee: NITA }

function baseInputs(overrides: Partial<PayrollInputs> = {}): PayrollInputs {
  return {
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
    ...overrides,
  }
}

/** Runs the real engine so every entry satisfies the deduction identity by construction. */
function entryFrom(inputs: PayrollInputs): AxJournalEntry {
  const r = computePayroll(inputs)
  return {
    basic_salary: inputs.base_salary,
    bonus_commission: inputs.bonus_commission,
    fringe_benefit: inputs.fringe_benefit,
    transport_allowance: inputs.transport_allowance,
    arrears: inputs.arrears,
    ot_other: inputs.ot_other,
    voluntary_pension: inputs.voluntary_pension,
    advances: inputs.advances,
    helb: inputs.helb,
    company_loan: inputs.company_loan,
    bank_loan: inputs.bank_loan,
    sacco: inputs.sacco,
    nssf_t1: r.nssf_t1,
    nssf_t2: r.nssf_t2,
    shif: r.shif,
    ahl: r.ahl,
    defined_pension_ee: r.defined_pension_ee,
    employer_pension: r.defined_pension_er,
    net_paye: r.net_paye,
    total_deductions: r.total_deductions,
    net_pay: r.net_salary,
  }
}

function makeInput(
  id: string,
  costCentre: string,
  inputs: Partial<PayrollInputs> = {},
  extra: { allocation?: Record<string, number>; grade?: string } = {},
): AxJournalEmployeeInput {
  return {
    employee: {
      id,
      department: "Production",
      cost_centre: costCentre,
      cost_centre_allocation: extra.allocation ?? null,
      grade: extra.grade ?? "Staff",
    },
    entry: entryFrom(baseInputs(inputs)),
  }
}

const sum = (ns: number[]) => +ns.reduce((a, b) => a + b, 0).toFixed(2)

describe("axPeriodLabel", () => {
  it("renders the YYMM label Tony puts in every Text cell", () => {
    expect(axPeriodLabel("2026-08")).toBe("2608")
    expect(axPeriodLabel("2024-11")).toBe("2411")
  })
})

describe("pensionExcessOverCap", () => {
  it("recovers the above-cap pension the engine deducts but the register doesn't name", () => {
    // 5% of 550,000 = 27,500 against a 20,000 cap → 7,500 excess (employee 1004's real case).
    const entry = entryFrom(baseInputs({ base_salary: 550000 }))
    expect(entry.defined_pension_ee).toBe(20000)
    expect(pensionExcessOverCap(entry)).toBe(7500)
  })

  it("is zero for an employee under the cap", () => {
    expect(pensionExcessOverCap(entryFrom(baseInputs({ base_salary: 100000 })))).toBe(0)
  })

  it("treats a cent or two of register rounding as noise, not pension", () => {
    const entry = entryFrom(baseInputs({ base_salary: 100000 }))
    expect(pensionExcessOverCap({ ...entry, total_deductions: +(entry.total_deductions + 0.01).toFixed(2) })).toBe(0)
    expect(pensionExcessOverCap({ ...entry, total_deductions: +(entry.total_deductions - 0.02).toFixed(2) })).toBe(0)
    // ...but a real excess a few shillings above the band is kept.
    expect(pensionExcessOverCap({ ...entry, total_deductions: +(entry.total_deductions + 5).toFixed(2) })).toBe(5)
  })
})

describe("buildAxPayrollJournal", () => {
  const inputs: AxJournalEmployeeInput[] = [
    makeInput("1031", "511", { transport_allowance: 5000, ot_other: 3000, advances: 10000 }),
    makeInput("1007", "204", { bonus_commission: 2500, helb: 4000, sacco: 1500, bank_loan: 3000 }),
    makeInput("1004", "121", { base_salary: 550000, fringe_benefit: 1500, company_loan: 41666 }),
    makeInput("1001", "121", { base_salary: 440577.94, voluntary_pension: 9000 }),
    makeInput("1005", "121", { base_salary: 440382.84, fringe_benefit: 161194.12 }, { allocation: { "121": 0.5, "512": 0.5 } }),
    makeInput("1099", "121", { base_salary: 30000 }, { grade: "Intern" }),
  ]
  const journal = buildAxPayrollJournal("2026-08", inputs, OPTIONS)
  const ledger = journal.rows.filter((r) => r.module === "Ledger")
  const bank = journal.rows.filter((r) => r.module === "Bank")
  const find = (number: string, text: string) => journal.rows.find((r) => r.number === number && r.text === text)
  const findAll = (number: string, text: string) => journal.rows.filter((r) => r.number === number && r.text === text)

  it("balances: ledger debits equal ledger credits to the cent", () => {
    expect(journal.isBalanced).toBe(true)
    expect(journal.ledgerDebitTotal).toBe(journal.ledgerCreditTotal)
  })

  it("puts every row on the same voucher, date and currency", () => {
    for (const row of journal.rows) {
      expect(row.voucher).toBe("SAL0000138")
      expect(row.date).toEqual(OPTIONS.postingDate)
      expect(row.currency).toBe("KES")
    }
  })

  it("orders the blocks the way Tony's file does: credits, rounding, debits, bank", () => {
    const firstDebit = ledger.findIndex((r) => r.amount > 0)
    const roundingIndex = ledger.findIndex((r) => r.number === AX_JOURNAL_ACCOUNTS.rounding)
    expect(ledger.slice(0, roundingIndex).every((r) => r.amount < 0)).toBe(true)
    expect(roundingIndex).toBeLessThan(firstDebit)
    expect(ledger.slice(firstDebit).every((r) => r.amount > 0)).toBe(true)
    // Bank rows come last.
    const lastLedger = journal.rows.map((r) => r.module).lastIndexOf("Ledger")
    const firstBank = journal.rows.map((r) => r.module).indexOf("Bank")
    expect(firstBank).toBeGreaterThan(lastLedger)
  })

  it("always emits the AX rounding line, at exactly 0 when the data is engine-exact", () => {
    const rounding = find(AX_JOURNAL_ACCOUNTS.rounding, "Ledger - rounding curr  SAL0000138")
    expect(rounding).toBeDefined()
    expect(rounding!.amount).toBe(0)
    expect(journal.roundingAdjustment).toBe(0)
    // ...and it is the ONLY zero-amount row.
    expect(journal.rows.filter((r) => r.amount === 0)).toHaveLength(1)
  })

  it("absorbs the register's ±0.01 rounding noise on the rounding line and still balances", () => {
    // The stored register rounds each deduction to 2dp but total_deductions
    // from the raw sum, so the parts can be a cent off the total either way.
    // Model eleven a cent under and five a cent over — the voucher must still
    // sum to zero, with the net 0.06 on AX's rounding line and NONE of it in
    // the pension credit.
    const noisy = Array.from({ length: 16 }, (_, i) => {
      const input = makeInput(`20${i}`, "511")
      const delta = i < 11 ? -0.01 : 0.01
      input.entry.total_deductions = +(input.entry.total_deductions + delta).toFixed(2)
      input.entry.net_pay = +(input.entry.net_pay - delta).toFixed(2)
      return input
    })
    const j = buildAxPayrollJournal("2026-08", noisy, OPTIONS)
    expect(j.roundingAdjustment).toBe(0.06)
    expect(j.rows.find((r) => r.number === AX_JOURNAL_ACCOUNTS.rounding)!.amount).toBe(0.06)
    expect(j.isBalanced).toBe(true)
    const cleanPension = sum(noisy.map((i) => i.entry.defined_pension_ee + i.entry.employer_pension))
    expect(j.rows.find((r) => r.text === "Salaries 2608-PENSION" && r.amount < 0)!.amount).toBe(-cleanPension)
    const signed = j.rows.filter((r) => r.module === "Ledger").reduce((s, r) => s + r.amount, 0)
    expect(Math.abs(signed)).toBeLessThan(0.005)
  })

  it("flags a journal whose residual is too large to be rounding", () => {
    const broken = [makeInput("1031", "511")]
    broken[0].entry.net_pay += 500 // a real inconsistency, not 2dp noise
    const j = buildAxPayrollJournal("2026-08", broken, OPTIONS)
    expect(j.isBalanced).toBe(false)
  })

  it("credits net pay to the salaries clearing account as 'Salaries YYMM'", () => {
    const expected = sum(inputs.map((i) => i.entry.net_pay))
    expect(find(AX_JOURNAL_ACCOUNTS.salariesClearing, "Salaries 2608")!.amount).toBe(-expected)
  })

  it("credits NSSF and AHL at employee + employer, and pension at EE + excess + ER", () => {
    const nssfEe = sum(inputs.map((i) => i.entry.nssf_t1 + i.entry.nssf_t2))
    const ahlEe = sum(inputs.map((i) => i.entry.ahl))
    const pension = sum(inputs.map((i) => i.entry.defined_pension_ee + pensionExcessOverCap(i.entry) + i.entry.employer_pension))
    expect(find(AX_JOURNAL_ACCOUNTS.salariesClearing, "Salaries 2608-NSSF")!.amount).toBe(-+(nssfEe * 2).toFixed(2))
    expect(find(AX_JOURNAL_ACCOUNTS.taxPayable, "Salaries 2608-AHL")!.amount).toBe(-+(ahlEe * 2).toFixed(2))
    expect(find(AX_JOURNAL_ACCOUNTS.salariesClearing, "Salaries 2608-PENSION")!.amount).toBe(-pension)
  })

  it("keeps the above-cap pension out of PRS: PRS is the voluntary input only", () => {
    expect(find(AX_JOURNAL_ACCOUNTS.salariesClearing, "Salaries 2608-PRS")!.amount).toBe(-9000)
  })

  it("books PAYE and NITA to the tax payable account, not to salaries clearing", () => {
    const paye = sum(inputs.map((i) => i.entry.net_paye))
    expect(find(AX_JOURNAL_ACCOUNTS.taxPayable, "Salaries 2608-PAYE")!.amount).toBe(-paye)
    expect(find(AX_JOURNAL_ACCOUNTS.taxPayable, "Salaries 2608-NITA")!.amount).toBe(-NITA * inputs.length)
    expect(find(AX_JOURNAL_ACCOUNTS.salariesClearing, "Salaries 2608-PAYE")).toBeUndefined()
  })

  it("routes loan and advance recoveries to the staff receivables account (no bank line)", () => {
    expect(find(AX_JOURNAL_ACCOUNTS.staffLoansReceivable, "Salaries 2608-Company loan")!.amount).toBe(-41666)
    expect(find(AX_JOURNAL_ACCOUNTS.staffLoansReceivable, "Salaries 2608-Advances")!.amount).toBe(-10000)
    expect(bank.some((r) => r.amount === -41666 || r.amount === -10000)).toBe(false)
  })

  it("leaves the fringe benefit out entirely — it is non-cash and tax-only", () => {
    expect(journal.rows.some((r) => /fringe|non-cash/i.test(r.text))).toBe(false)
    // Debit salaries exclude fringe: employee 1004 books 550,000, not 551,500.
    const cc121Salaries = findAll(`${AX_JOURNAL_ACCOUNTS.salariesExpensePrefix}-121`, "Salaries 2608")
    const mainLine = cc121Salaries[0]
    // Main 121 line = 1004 + 1001 (the intern and the split GM are on other lines).
    expect(mainLine.amount).toBe(+(550000 + 440577.94).toFixed(2))
  })

  it("labels variable pay PROD for production and SALES for cost centre 204", () => {
    expect(find(`${AX_JOURNAL_ACCOUNTS.variablePayExpensePrefix}-511`, "Salaries 2608-PROD")!.amount).toBe(3000)
    expect(find(`${AX_JOURNAL_ACCOUNTS.variablePayExpensePrefix}-204`, "Salaries 2608-SALES")!.amount).toBe(2500)
  })

  it("posts a cost-centre-split employee as his own line under each centre, not merged", () => {
    const salaries121 = findAll(`${AX_JOURNAL_ACCOUNTS.salariesExpensePrefix}-121`, "Salaries 2608")
    const salaries512 = findAll(`${AX_JOURNAL_ACCOUNTS.salariesExpensePrefix}-512`, "Salaries 2608")
    expect(salaries121).toHaveLength(2) // main + the GM's half
    expect(salaries512).toHaveLength(1) // only the GM's half lives in 512
    expect(salaries121[1].amount).toBe(220191.42)
    expect(salaries512[0].amount).toBe(220191.42)
    // Same for his employer costs: NITA 25/25, and the pension/NSSF/AHL halves.
    expect(find(`${AX_JOURNAL_ACCOUNTS.nitaExpensePrefix}-512`, "Salaries 2608-NITA")!.amount).toBe(25)
    expect(findAll(`${AX_JOURNAL_ACCOUNTS.nitaExpensePrefix}-121`, "Salaries 2608-NITA").map((r) => r.amount)).toEqual([150, 25])
  })

  it("books an intern's salary to the intern account instead of salaries", () => {
    expect(find(`${AX_JOURNAL_ACCOUNTS.internSalariesExpensePrefix}-121`, "Salaries 2608-INTERN")!.amount).toBe(30000)
  })

  it("books employer NSSF, AHL and pension as cost-centred expense lines", () => {
    const e1031 = inputs[0].entry
    expect(find(`${AX_JOURNAL_ACCOUNTS.employerStatutoryExpensePrefix}-511`, "Salaries 2608-NSSF")!.amount).toBe(+(e1031.nssf_t1 + e1031.nssf_t2).toFixed(2))
    expect(find(`${AX_JOURNAL_ACCOUNTS.employerStatutoryExpensePrefix}-511`, "Salaries 2608-AHL")!.amount).toBe(e1031.ahl)
    expect(find(`${AX_JOURNAL_ACCOUNTS.employerPensionExpensePrefix}-511`, "Salaries 2608-PENSION")!.amount).toBe(e1031.employer_pension)
  })

  it("mirrors every salaries-clearing credit as a BARKSH bank line with no text", () => {
    const clearing = ledger.filter((r) => r.number === AX_JOURNAL_ACCOUNTS.salariesClearing)
    expect(bank).toHaveLength(clearing.length)
    expect(bank.map((r) => r.amount)).toEqual(clearing.map((r) => r.amount))
    for (const row of bank) {
      expect(row.number).toBe("BARKSH")
      expect(row.text).toBe("")
    }
    expect(journal.bankTotal).toBe(+(-clearing.reduce((s, r) => s + r.amount, 0)).toFixed(2))
  })

  it("total employer cost = cash earnings + employer NSSF, AHL, pension and NITA", () => {
    const cash = sum(inputs.map((i) => i.entry.basic_salary + i.entry.transport_allowance + i.entry.arrears + i.entry.ot_other + i.entry.bonus_commission))
    const employer = sum(inputs.map((i) => i.entry.nssf_t1 + i.entry.nssf_t2 + i.entry.ahl + i.entry.employer_pension + NITA))
    expect(journal.ledgerDebitTotal).toBe(+(cash + employer).toFixed(2))
  })
})

describe("axJournalToXlsx", () => {
  it("writes Tony's exact header row, sheet name and column layout", () => {
    const journal = buildAxPayrollJournal("2026-08", [makeInput("1031", "511")], OPTIONS)
    // cellNF: number formats are always written, but SheetJS only surfaces
    // them on read when asked to.
    const workbook = XLSX.read(axJournalToXlsx(journal), { type: "buffer", cellDates: true, cellNF: true })
    expect(workbook.SheetNames).toEqual(["Sheet1"])
    const sheet = workbook.Sheets.Sheet1
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
    expect(rows[0]).toEqual([
      "Module", "Voucher", "Date", "Number", "Text", "Currency",
      "Amount in transaction currency", "Amount", "Dimensions", "Number2",
    ])
    expect(rows).toHaveLength(journal.rows.length + 1)
    // First data row: Ledger / voucher / date / 11500-06020 / Salaries 2608 / KES / amount / amount.
    const first = rows[1] as unknown[]
    expect(first[0]).toBe("Ledger")
    expect(first[1]).toBe("SAL0000138")
    expect(first[2]).toBeInstanceOf(Date)
    expect(first[3]).toBe(AX_JOURNAL_ACCOUNTS.salariesClearing)
    expect(first[4]).toBe("Salaries 2608")
    expect(first[5]).toBe("KES")
    expect(first[6]).toBe(first[7])
    expect(sheet["G2"].z).toBe("#,##0.00")
    expect(sheet["C2"].z).toBe("mm-dd-yy")
    // Column widths are written but not round-tripped by SheetJS's reader,
    // so check them on the sheet as built (openpyxl on the real file agrees).
    expect(axJournalToSheet(journal)["!cols"]!.map((c) => c.wch)).toEqual([10, 14, 13, 22, 38, 12, 34, 15, 14, 11])
  })
})
