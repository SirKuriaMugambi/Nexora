import * as XLSX from "xlsx"
import {
  BANK_BATCH_CONFIG,
  bankBatchToXlsx,
  bankDateNumber,
  buildBankBatch,
  salaryNarrative,
  type BankBatchRow,
} from "@/lib/bank-batch-builder"

const PAY_DATE = new Date(2024, 10, 26) // 26 Nov 2024, the source file's date

function row(staffNo: string, empCode: string, net: number, over: Partial<BankBatchRow> = {}): BankBatchRow {
  return {
    staffNo,
    name: `Employee ${staffNo}`,
    bankAccountNumber: "0951061050",
    bankBranchCode: "03095",
    empCode,
    netSalary: net,
    ...over,
  }
}

describe("bankDateNumber", () => {
  it("writes the date as the plain DDMMYYYY number the bank expects", () => {
    expect(bankDateNumber(new Date(2024, 10, 26))).toBe(26112024)
    expect(bankDateNumber(new Date(2026, 7, 3))).toBe(3082026)
  })
})

describe("salaryNarrative", () => {
  it("renders the month the way the source file does", () => {
    expect(salaryNarrative("2024-11")).toBe("NOV SALARY")
    expect(salaryNarrative("2026-08")).toBe("AUG SALARY")
  })
})

describe("buildBankBatch", () => {
  const rows = [row("1000", "EMP001", 258896.20), row("1001", "EMP002", 279800.00)]
  const batch = buildBankBatch(rows, "2024-11", PAY_DATE)

  it("opens with the header record", () => {
    expect(batch.rows[0]).toEqual([1, "LOCAL", "CR", 26112024, "000800"])
  })

  it("carries the company debit record, with the total and company name", () => {
    expect(batch.rows[1]).toEqual([
      2, BANK_BATCH_CONFIG.companyAccount, "03", "045", "KES",
      26112024, "NOV SALARY", "SALARYPAYT", 538696.20, "CHRYSALAFRICALTD",
    ])
  })

  it("writes one detail record per employee", () => {
    expect(batch.rows[2]).toEqual([3, "0951061050", "03095", 26112024, "KES", 258896.20, "1000", "EMP001"])
    expect(batch.rows[3][7]).toBe("EMP002")
  })

  it("closes with a trailer counting every row in the file, itself included", () => {
    // header + debit + 2 details + trailer = 5
    expect(batch.rows[4]).toEqual([9, 5, 538696.20])
    expect(batch.recordCount).toBe(5)
  })

  it("the debit total, the trailer total and the detail rows all agree", () => {
    const details = batch.rows.filter((r) => r[0] === 3)
    const sum = +details.reduce((s, r) => s + Number(r[5]), 0).toFixed(2)
    expect(sum).toBe(batch.total)
    expect(batch.rows[1][8]).toBe(batch.total)
    expect(batch.rows[4][2]).toBe(batch.total)
  })

  it("holds back an employee the bank could not route, rather than writing blanks", () => {
    const b = buildBankBatch(
      [
        row("1000", "EMP001", 1000),
        row("1002", "EMP003", 5000, { bankBranchCode: "" }),
        row("1003", "EMP004", 6000, { bankAccountNumber: "N/A" }),
        row("1004", "EMP005", 7000, { empCode: "" }),
      ],
      "2024-11",
      PAY_DATE,
    )
    expect(b.rows.filter((r) => r[0] === 3)).toHaveLength(1)
    expect(b.skipped.map((s) => s.staffNo)).toEqual(["1002", "1003", "1004"])
    expect(b.skipped[0].reason).toContain("bank branch code")
    expect(b.skipped[1].reason).toContain("account number")
    expect(b.skipped[2].reason).toContain("employee reference")
    // The totals must reflect only what is actually being paid.
    expect(b.total).toBe(1000)
    expect(b.rows[1][8]).toBe(1000)
  })
})

describe("bankBatchToXlsx", () => {
  it("keeps leading zeros on account numbers and branch codes", () => {
    const batch = buildBankBatch([row("1000", "EMP001", 258896.20)], "2024-11", PAY_DATE)
    const wb = XLSX.read(bankBatchToXlsx(batch), { type: "buffer", cellNF: true })
    expect(wb.SheetNames).toEqual(["BANK DETAILS"])
    const ws = wb.Sheets["BANK DETAILS"]
    // Row 3 is the first detail record.
    expect(ws.B3.v).toBe("0951061050")
    expect(ws.B3.t).toBe("s")
    expect(ws.C3.v).toBe("03095")
    expect(ws.C3.t).toBe("s")
    expect(ws.F3.v).toBeCloseTo(258896.20, 2)
    expect(ws.F3.z).toBe("0.00")
  })
})
