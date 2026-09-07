export interface Vendor {
  vendor_id: string
  name: string
  type: "Supplier" | "Consultant" | "Logistics"
  tax_id_pin: string
  contact_person: string
  email: string
  phone: string
  bank_account: string
  vat_treatment: "Standard (16%)" | "Zero Rated (0%)" | "Exempt"
  wht_type: "2%" | "5%" | "Exempt"
  currency: string
  default_ledger: string
  default_department: string
  default_cost_centre: string
  payment_terms: string
  status: "Active" | "Inactive" | "On Hold"
  notes: string
}

export interface Invoice {
  id: string
  vendor_name: string
  vendor_id: string
  invoice_number: string
  cu_invoice_number: string
  invoice_date: string
  due_date: string
  subtotal: number
  vat_treatment: string
  vat_amount: number
  total: number
  currency: string
  wht_type: string
  wht_amount: number
  cost_centre: string
  gl_account: string
  department: string
  approved_by: string
  approval_date: string | null
  status: "Draft" | "Pending" | "Approved" | "Posted"
  kra_rate?: number
}

export interface WhtPayment {
  id: string
  vendor_name: string
  vendor_pin: string
  cu_invoice_number: string
  invoice_date: string
  payment_date: string
  gross_amount: number
  wht_rate: number
  wht_amount: number
  payment_ref: string
  status: "Calculated" | "Filed"
  kra_reference?: string
}

export interface GLAccount {
  code: string
  name: string
  type: "Asset" | "Liability" | "Equity" | "Revenue" | "Cost of Sales" | "Expense"
  department: string
  cost_centre: string
}

export interface Employee {
  // Identity
  id: string               // Staff No
  name: string
  national_id?: string
  kra_pin: string          // KRA PIN
  sha_pin?: string | null
  grade: string
  cost_centre: string      // e.g. "121", "204", "511", "512"
  // Overrides cost_centre for GL/journal purposes when set: costCentre ->
  // fractional share (0-1, summing to 1) for a shared-services employee
  // whose cost splits across multiple centres. See lib/cost-allocation.ts.
  cost_centre_allocation?: Record<string, number> | null
  department: string       // e.g. "Finance", "Technical", "Production"
  bank_name?: string
  bank_account_number?: string
  email?: string | null

  // Per-employee statutory exceptions — see lib/payroll-engine.ts file header.
  // All default to standard treatment; only set for employees Tony confirms.
  personal_relief_override?: number | null
  paye_band_flat_deduction?: number | null
  pension_rate_override?: number | null
  nssf_t2_override?: number | null
  ahl_relief_override?: number | null

  // Earnings (matching Excel Sheet 2 columns 4-9)
  base_salary: number             // Basic
  bonus_commission: number        // Bonus/Comm
  fringe_benefit: number          // Fringe benefit / Loan non-cash (FBT)
  transport_allowance: number     // Transport/Hse Allowance
  arrears: number                 // Arrears
  ot_other: number                // Salary Arrears/OT/Others
  gross_salary: number            // Gross Salary (computed)

  // Pre-PAYE deductions (reduce taxable income)
  voluntary_pension: number       // Employee voluntary pension
  defined_pension_ee: number      // Defined pension EE 5%
  defined_pension_er: number      // Employer pension 10%
  nssf_t1: number                 // NSSF Tier I — KES 420
  nssf_t2: number                 // NSSF Tier II — KES 1,740
  shif: number                    // SHIF (2.75% of gross)
  ahl: number                     // Housing levy 1.5%

  // Tax computation
  taxable_pay: number             // Gross less pre-PAYE deductions
  gross_paye: number              // PAYE before reliefs
  personal_relief: number         // KES 2,400
  nhif_relief: number             // NHIF/SHIF relief
  ahl_relief: number              // AHL relief
  net_paye: number                // Final PAYE after reliefs

  // Other post-tax deductions
  advances: number                // Salary advance
  helb: number                    // HELB
  company_loan: number            // Company / staff loan
  bank_loan: number               // Bank loan
  sacco: number                   // SACCO

  // Totals
  allowances: number              // Legacy total (kept for backward compat)
  deductions: number              // Total deductions
  nssf: number                    // Legacy NSSF (= nssf_t1 + nssf_t2)
  nhif: number                    // Legacy NHIF (= shif)
  paye: number                    // Legacy PAYE (= net_paye)
  net_salary: number              // Net Pay
}

export interface ChecklistItem {
  id: string
  task: string
  assigned_to: string
  status: "Pending" | "In Progress" | "Complete" | "On Hold"
  completed_date: string | null
  approver: string | null
}

export interface AuditLog {
  id: string
  timestamp: string
  user: string
  action: string
  document_ref: string
  details: string
  amount?: number
}

export interface BudgetItem {
  id: string
  cost_centre: string
  gl_account: string
  month: string
  budget_amount: number
  actual_amount: number
}

export interface Document {
  id: string
  name: string
  tag: "invoice" | "po" | "bank statement" | "payroll" | "kra confirmation" | "wht certificate" | "other"
  uploaded_by: string
  uploaded_at: string
  size: string
  storage_path?: string
  associated_tx?: string
}

export const initialVendors: Vendor[] = [
  {
    vendor_id: "V001",
    name: "Bayer East Africa",
    type: "Supplier",
    tax_id_pin: "P051122334A",
    contact_person: "Peter Kamau",
    email: "peter.kamau@bayer.com",
    phone: "+254 711 000 111",
    bank_account: "NCBA A/C 988223344",
    vat_treatment: "Standard (16%)",
    wht_type: "2%",
    currency: "KES",
    default_ledger: "5000 (COGS - Raw Materials)",
    default_department: "OPS",
    default_cost_centre: "511 (Production)",
    payment_terms: "Net 30",
    status: "Active",
    notes: "Primary agrochemical and crop protection supplier."
  },
  {
    vendor_id: "V002",
    name: "DHL Express Kenya",
    type: "Logistics",
    tax_id_pin: "P051144229B",
    contact_person: "Sarah Mwangi",
    email: "sarah.mwangi@dhl.com",
    phone: "+254 722 555 444",
    bank_account: "Standard Chartered A/C 445522331",
    vat_treatment: "Standard (16%)",
    wht_type: "2%",
    currency: "USD",
    default_ledger: "5100 (Freight-in & Import Logistics)",
    default_department: "OPS",
    default_cost_centre: "511 (Production)",
    payment_terms: "Net 15",
    status: "Active",
    notes: "Handles express imports of parent formulation raw materials."
  },
  {
    vendor_id: "V003",
    name: "Deloitte Kenya",
    type: "Consultant",
    tax_id_pin: "P051166338C",
    contact_person: "Anthony Mwangi",
    email: "amwangi@deloitte.co.ke",
    phone: "+254 20 423 4000",
    bank_account: "Absa Bank A/C 123889900",
    vat_treatment: "Standard (16%)",
    wht_type: "5%",
    currency: "KES",
    default_ledger: "6200 (Professional & Consultancy)",
    default_department: "FIN",
    default_cost_centre: "121 (Finance)",
    payment_terms: "Net 30",
    status: "Active",
    notes: "Tax consultation and auditing services."
  },
  {
    vendor_id: "V004",
    name: "Syngenta Flowers East Africa",
    type: "Supplier",
    tax_id_pin: "P051188112D",
    contact_person: "Mercy Wanjiku",
    email: "mercy.wanjiku@syngenta.com",
    phone: "+254 733 999 888",
    bank_account: "Stanbic Bank A/C 882211993",
    vat_treatment: "Zero Rated (0%)",
    wht_type: "Exempt",
    currency: "KES",
    default_ledger: "5000 (COGS - Raw Materials)",
    default_department: "OPS",
    default_cost_centre: "511 (Production)",
    payment_terms: "Net 45",
    status: "Active",
    notes: "Seedlings and vegetative propagation stock."
  },
  {
    vendor_id: "V005",
    name: "Kenya Power & Lighting Co.",
    type: "Supplier",
    tax_id_pin: "P000123456E",
    contact_person: "Billing Officer",
    email: "billing@kplc.co.ke",
    phone: "95551",
    bank_account: "KCB Utility Paybill 888888",
    vat_treatment: "Standard (16%)",
    wht_type: "Exempt",
    currency: "KES",
    default_ledger: "6100 (Rent & Utilities)",
    default_department: "OPS",
    default_cost_centre: "511 (Production)",
    payment_terms: "Due on Receipt",
    status: "Active",
    notes: "Electricity utility supplier."
  }
]

export const initialInvoices: Invoice[] = [
  {
    id: "INV-2026-001",
    vendor_name: "Bayer East Africa",
    vendor_id: "V001",
    invoice_number: "BY-998822",
    cu_invoice_number: "CU-BY-998822",
    invoice_date: "2026-06-15",
    due_date: "2026-07-15",
    subtotal: 1200000,
    vat_treatment: "Standard (16%)",
    vat_amount: 192000,
    total: 1392000,
    currency: "KES",
    wht_type: "2%",
    wht_amount: 24000,
    cost_centre: "511 (Production)",
    gl_account: "5000 (COGS - Raw Materials)",
    department: "OPS",
    approved_by: "Harrison",
    approval_date: "2026-06-16",
    status: "Approved"
  },
  {
    id: "INV-2026-002",
    vendor_name: "DHL Express Kenya",
    vendor_id: "V002",
    invoice_number: "DHL-112233",
    cu_invoice_number: "CU-DH-112233",
    invoice_date: "2026-06-18",
    due_date: "2026-07-03",
    subtotal: 8500, // USD
    vat_treatment: "Standard (16%)",
    vat_amount: 1360,
    total: 9860,
    currency: "USD",
    wht_type: "2%",
    wht_amount: 170, // USD
    cost_centre: "511 (Production)",
    gl_account: "5100 (Freight-in & Import Logistics)",
    department: "OPS",
    approved_by: "Harrison",
    approval_date: "2026-06-19",
    status: "Approved",
    kra_rate: 129.50
  },
  {
    id: "INV-2026-003",
    vendor_name: "Deloitte Kenya",
    vendor_id: "V003",
    invoice_number: "DL-554433",
    cu_invoice_number: "CU-DL-554433",
    invoice_date: "2026-06-20",
    due_date: "2026-07-20",
    subtotal: 2500000,
    vat_treatment: "Standard (16%)",
    vat_amount: 400000,
    total: 2900000,
    currency: "KES",
    wht_type: "5%",
    wht_amount: 125000,
    cost_centre: "121 (Finance)",
    gl_account: "6200 (Professional & Consultancy)",
    department: "FIN",
    approved_by: "Tony",
    approval_date: "2026-06-22",
    status: "Pending"
  }
]

export const initialWhtPayments: WhtPayment[] = [
  {
    id: "WHT-2026-001",
    vendor_name: "Bayer East Africa",
    vendor_pin: "P051122334A",
    cu_invoice_number: "CU-BY-998822",
    invoice_date: "2026-06-15",
    payment_date: "2026-06-28",
    gross_amount: 1200000,
    wht_rate: 0.02,
    wht_amount: 24000,
    payment_ref: "EFT-BYR-88221",
    status: "Calculated"
  },
  {
    id: "WHT-2026-002",
    vendor_name: "DHL Express Kenya",
    vendor_pin: "P051144229B",
    cu_invoice_number: "CU-DH-112233",
    invoice_date: "2026-06-18",
    payment_date: "2026-06-29",
    gross_amount: 1100750, // 8500 USD * 129.50 KRA Rate
    wht_rate: 0.02,
    wht_amount: 22015,
    payment_ref: "EFT-DHL-11990",
    status: "Calculated"
  }
]

export const initialGLAccounts: GLAccount[] = [
  { code: "1010", name: "Bank Account - KES", type: "Asset", department: "FIN", cost_centre: "121" },
  { code: "1020", name: "Bank Account - USD", type: "Asset", department: "FIN", cost_centre: "121" },
  { code: "1100", name: "Accounts Receivable - Trade", type: "Asset", department: "CS", cost_centre: "208" },
  { code: "1110", name: "Accounts Receivable - Intercompany (Chrysal BV)", type: "Asset", department: "FIN", cost_centre: "121" },
  { code: "1200", name: "Inventory - Finished Goods", type: "Asset", department: "OPS", cost_centre: "511" },
  { code: "1300", name: "Fixed Assets", type: "Asset", department: "OPS", cost_centre: "511" },
  { code: "2000", name: "Accounts Payable - Trade", type: "Liability", department: "FIN", cost_centre: "121" },
  { code: "2010", name: "Accounts Payable - Intercompany (Chrysal BV)", type: "Liability", department: "FIN", cost_centre: "121" },
  { code: "2100", name: "Taxes Payable (KRA WHT/PAYE/VAT)", type: "Liability", department: "FIN", cost_centre: "121" },
  { code: "2300", name: "Payroll Payable", type: "Liability", department: "FIN", cost_centre: "121" },
  { code: "3000", name: "Share Capital", type: "Equity", department: "FIN", cost_centre: "000" },
  { code: "3100", name: "Retained Earnings", type: "Equity", department: "FIN", cost_centre: "000" },
  { code: "4000", name: "Export Sales - Flowers", type: "Revenue", department: "OPS", cost_centre: "511" },
  { code: "4100", name: "Local Sales", type: "Revenue", department: "CS", cost_centre: "208" },
  { code: "4200", name: "Intercompany Revenue (Chrysal BV)", type: "Revenue", department: "FIN", cost_centre: "121" },
  { code: "5000", name: "COGS - Raw Materials", type: "Cost of Sales", department: "OPS", cost_centre: "511" },
  { code: "5100", name: "Freight-in & Import Logistics", type: "Cost of Sales", department: "OPS", cost_centre: "511" },
  { code: "5200", name: "Direct Labour", type: "Cost of Sales", department: "OPS", cost_centre: "511" },
  { code: "6000", name: "Salaries & Wages", type: "Expense", department: "FIN", cost_centre: "121" },
  { code: "6010", name: "NSSF/NHIF Contributions", type: "Expense", department: "FIN", cost_centre: "121" },
  { code: "6100", name: "Rent & Utilities", type: "Expense", department: "OPS", cost_centre: "511" },
  { code: "6200", name: "Professional & Consultancy Fees", type: "Expense", department: "FIN", cost_centre: "121" },
  { code: "7100", name: "Intercompany Charges (Chrysal BV)", type: "Expense", department: "FIN", cost_centre: "121" }
]

export const initialEmployees: Employee[] = [
  // ── Finance (CC 121) ────────────────────────────────────────────────────────
  {
    id: "1000", name: "Redbad Verduijn", kra_pin: "A000000001Z", grade: "GM", cost_centre: "121", department: "Finance",
    base_salary: 398051.75, bonus_commission: 0, fringe_benefit: 545.83, transport_allowance: 0,
    arrears: 0, ot_other: 0, gross_salary: 398597.58,
    voluntary_pension: 0, defined_pension_ee: 19902.59, defined_pension_er: 39805.18,
    nssf_t1: 420, nssf_t2: 1740, shif: 10946.42, ahl: 5970.78,
    taxable_pay: 376534.99, gross_paye: 108362.08,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 895.62, net_paye: 100175.74,
    advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0,
    allowances: 545.83, deductions: 139155.53, nssf: 2160, nhif: 10946.42, paye: 100175.74, net_salary: 258896.23,
  },
  {
    id: "1001", name: "Ivy Atieno", kra_pin: "A000000002Z", grade: "Grade 5", cost_centre: "121", department: "Finance",
    base_salary: 440577.94, bonus_commission: 0, fringe_benefit: 390, transport_allowance: 0,
    arrears: 0, ot_other: 0, gross_salary: 440967.94,
    voluntary_pension: 11028.90, defined_pension_ee: 20000, defined_pension_er: 45797.79,
    nssf_t1: 420, nssf_t2: 1740, shif: 12115.89, ahl: 6608.67,
    taxable_pay: 418807.94, gross_paye: 113573.18,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 991.30, net_paye: 108864.47,
    advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0,
    allowances: 390, deductions: 160777.93, nssf: 2160, nhif: 12115.89, paye: 108864.47, net_salary: 279800.01,
  },
  // ── General Manager (CC 205) ─────────────────────────────────────────────────
  {
    id: "1004", name: "Keziah Kiarie", kra_pin: "A000000005Z", grade: "GM", cost_centre: "205", department: "General Manager",
    base_salary: 550000, bonus_commission: 0, fringe_benefit: 1500, transport_allowance: 0,
    arrears: 0, ot_other: 0, gross_salary: 551500,
    voluntary_pension: 7500, defined_pension_ee: 20000, defined_pension_er: 56740,
    nssf_t1: 420, nssf_t2: 1740, shif: 15125, ahl: 8250,
    taxable_pay: 529340, gross_paye: 155020,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 1237.50, net_paye: 151382.47,
    advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0,
    allowances: 1500, deductions: 204417.47, nssf: 2160, nhif: 15125, paye: 151382.47, net_salary: 345582.53,
  },
  // ── Technical (CC 204) ───────────────────────────────────────────────────────
  {
    id: "1002", name: "Benson Kidake", kra_pin: "A000000003Z", grade: "Grade 4", cost_centre: "204", department: "Technical",
    base_salary: 240632.93, bonus_commission: 0, fringe_benefit: 8766.42, transport_allowance: 5437.22,
    arrears: 0, ot_other: 0, gross_salary: 254836.56,
    voluntary_pension: 0, defined_pension_ee: 12031.65, defined_pension_er: 25803.29,
    nssf_t1: 420, nssf_t2: 1740, shif: 6617.41, ahl: 3609.49,
    taxable_pay: 240644.92, gross_paye: 66976.28,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 541.42, net_paye: 64034.85,
    advances: 0, helb: 0, company_loan: 20833, bank_loan: 34334, sacco: 0,
    allowances: 14203.64, deductions: 143620.40, nssf: 2160, nhif: 6617.41, paye: 64034.85, net_salary: 102449.75,
  },
  {
    id: "1003", name: "Antony Agoi", kra_pin: "A000000004Z", grade: "Grade 4", cost_centre: "204", department: "Technical",
    base_salary: 155770, bonus_commission: 0, fringe_benefit: 8487.67, transport_allowance: 5437.22,
    arrears: 0, ot_other: 0, gross_salary: 169694.88,
    voluntary_pension: 0, defined_pension_ee: 7788.50, defined_pension_er: 17317,
    nssf_t1: 420, nssf_t2: 1740, shif: 4283.68, ahl: 2336.55,
    taxable_pay: 159746.38, gross_paye: 42706.71,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 350.48, net_paye: 39956.23,
    advances: 0, helb: 0, company_loan: 20833, bank_loan: 0, sacco: 0,
    allowances: 13924.89, deductions: 77357.96, nssf: 2160, nhif: 4283.68, paye: 39956.23, net_salary: 83849.26,
  },
  // ── Technical Assistants (CC 206) ────────────────────────────────────────────
  {
    id: "1005", name: "Vincent Mambo", kra_pin: "A000000006Z", grade: "Grade 3", cost_centre: "206", department: "Technical",
    base_salary: 440382.84, bonus_commission: 0, fringe_benefit: 161194.12, transport_allowance: 0,
    arrears: 0, ot_other: 57039.51, gross_salary: 658616.47,
    voluntary_pension: 2019.14, defined_pension_ee: 20000, defined_pension_er: 45778.28,
    nssf_t1: 420, nssf_t2: 1740, shif: 12110.53, ahl: 6605.74,
    taxable_pay: 636456.47, gross_paye: 196332.83,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 0, net_paye: 196332.83,
    advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0,
    allowances: 218233.63, deductions: 239228.24, nssf: 2160, nhif: 12110.53, paye: 196332.83, net_salary: 258194.11,
  },
  // ── Production (CC 511) ───────────────────────────────────────────────────────
  {
    id: "1031", name: "James Kariuki", kra_pin: "A000000031Z", grade: "Grade 3", cost_centre: "511", department: "Production",
    base_salary: 143447.99, bonus_commission: 0, fringe_benefit: 2090.40, transport_allowance: 0,
    arrears: 0, ot_other: 0, gross_salary: 145538.39,
    voluntary_pension: 0, defined_pension_ee: 7172.40, defined_pension_er: 16084.80,
    nssf_t1: 420, nssf_t2: 1740, shif: 3944.82, ahl: 2151.72,
    taxable_pay: 136205.99, gross_paye: 35644.60,
    personal_relief: 3000.15, nhif_relief: 0, ahl_relief: 322.76, net_paye: 32321.69,
    advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 15000,
    allowances: 2090.40, deductions: 62750.63, nssf: 2160, nhif: 3944.82, paye: 32321.69, net_salary: 80697.36,
  },
  {
    id: "1032", name: "Samuel Mwai", kra_pin: "A000000032Z", grade: "Grade 2", cost_centre: "511", department: "Production",
    base_salary: 52450.94, bonus_commission: 0, fringe_benefit: 600, transport_allowance: 5437.22,
    arrears: 0, ot_other: 10728.60, gross_salary: 69216.76,
    voluntary_pension: 0, defined_pension_ee: 2622.55, defined_pension_er: 6985.09,
    nssf_t1: 420, nssf_t2: 1740, shif: 1442.40, ahl: 786.76,
    taxable_pay: 64434.21, gross_paye: 14113.06,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 118.01, net_paye: 11595.05,
    advances: 15000, helb: 0, company_loan: 0, bank_loan: 14683, sacco: 0,
    allowances: 16765.82, deductions: 48289.76, nssf: 2160, nhif: 1442.40, paye: 11595.05, net_salary: 20326.99,
  },
  // ── Production-OH (CC 512) ────────────────────────────────────────────────────
  {
    id: "1008", name: "David Muthoni", kra_pin: "A000000008Z", grade: "Grade 4", cost_centre: "512", department: "Production-OH",
    base_salary: 362317.38, bonus_commission: 0, fringe_benefit: 127355.36, transport_allowance: 0,
    arrears: 0, ot_other: 53729.11, gross_salary: 543401.86,
    voluntary_pension: 0, defined_pension_ee: 18115.87, defined_pension_er: 37971.74,
    nssf_t1: 420, nssf_t2: 1740, shif: 9963.73, ahl: 7322.59,
    taxable_pay: 523125.99, gross_paye: 152388.08,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 1098.39, net_paye: 148889.69,
    advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0,
    allowances: 181084.47, deductions: 186451.88, nssf: 2160, nhif: 9963.73, paye: 148889.69, net_salary: 231199.27,
  },
  {
    id: "1009", name: "Lucy Wangari", kra_pin: "A000000009Z", grade: "Grade 4", cost_centre: "512", department: "Production-OH",
    base_salary: 366038.21, bonus_commission: 0, fringe_benefit: 126393.96, transport_allowance: 0,
    arrears: 0, ot_other: 53729.11, gross_salary: 546161.28,
    voluntary_pension: 0, defined_pension_ee: 18301.91, defined_pension_er: 38343.82,
    nssf_t1: 420, nssf_t2: 1740, shif: 10066.05, ahl: 5476.15,
    taxable_pay: 525699.37, gross_paye: 145159.89,
    personal_relief: 2400, nhif_relief: 0, ahl_relief: 821.42, net_paye: 141938.47,
    advances: 0, helb: 0, company_loan: 0, bank_loan: 0, sacco: 0,
    allowances: 180123.07, deductions: 177942.58, nssf: 2160, nhif: 10066.05, paye: 141938.47, net_salary: 241824.74,
  },
]


export const initialChecklist: ChecklistItem[] = [
  { id: "CHK-01", task: "All invoices received and entered", assigned_to: "Mercy", status: "Complete", completed_date: "2026-06-30", approver: "Tony" },
  { id: "CHK-02", task: "3-way matching complete (PO ↔ Invoice ↔ Delivery)", assigned_to: "Harrison", status: "Complete", completed_date: "2026-06-29", approver: "Tony" },
  { id: "CHK-03", task: "AP reconciled to vendor statements", assigned_to: "Mercy", status: "In Progress", completed_date: null, approver: null },
  { id: "CHK-04", task: "Bank reconciliation completed", assigned_to: "Tony", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-05", task: "WHT calculated and filed with KRA (by 20th)", assigned_to: "Mercy", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-06", task: "AR receipts matched to invoices", assigned_to: "Mercy", status: "In Progress", completed_date: null, approver: null },
  { id: "CHK-07", task: "Customer WHT certificates tracked", assigned_to: "Mercy", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-08", task: "Payroll processed and posted", assigned_to: "Tony", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-09", task: "Budget vs actual reviewed", assigned_to: "Charles", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-10", task: "Intercompany balances reconciled", assigned_to: "Tony", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-11", task: "Month-end adjustments entered (accruals, provisioning)", assigned_to: "Tony", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-12", task: "Trial balance pulled", assigned_to: "Mercy", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-13", task: "Financial statements reviewed", assigned_to: "Charles", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-14", task: "Month-end report sent to management", assigned_to: "Charles", status: "Pending", completed_date: null, approver: null },
  { id: "CHK-15", task: "Audit trail exported and archived", assigned_to: "Mercy", status: "Pending", completed_date: null, approver: null }
]

export const initialBudgets: BudgetItem[] = [
  { id: "B001", cost_centre: "511 (Production)", gl_account: "5000 (COGS - Raw Materials)", month: "2026-06", budget_amount: 1500000, actual_amount: 1200000 },
  { id: "B002", cost_centre: "511 (Production)", gl_account: "5100 (Freight-in & Import Logistics)", month: "2026-06", budget_amount: 1200000, actual_amount: 1100750 },
  { id: "B003", cost_centre: "121 (Finance)", gl_account: "6200 (Professional & Consultancy Fees)", month: "2026-06", budget_amount: 3000000, actual_amount: 2500000 },
  { id: "B004", cost_centre: "511 (Production)", gl_account: "6100 (Rent & Utilities)", month: "2026-06", budget_amount: 500000, actual_amount: 480000 },
  { id: "B005", cost_centre: "121 (Finance)", gl_account: "6000 (Salaries & Wages)", month: "2026-06", budget_amount: 1000000, actual_amount: 860000 }
]

export const initialAuditTrail: AuditLog[] = [
  { id: "AUD-001", timestamp: "2026-07-02 08:30:00", user: "Mercy", action: "USER LOGIN", document_ref: "Session Start", details: "Mercy logged in successfully from Nairobi timezone." },
  { id: "AUD-002", timestamp: "2026-06-15 10:15:00", user: "Mercy", action: "INVOICE PROCESSED", document_ref: "INV-2026-001", details: "Uploaded and processed Bayer East Africa Invoice (BY-998822) for KES 1,392,000.", amount: 1392000 },
  { id: "AUD-003", timestamp: "2026-06-16 09:45:00", user: "Harrison", action: "INVOICE APPROVED", document_ref: "INV-2026-001", details: "Approved Bayer East Africa Invoice (BY-998822) for Production division.", amount: 1392000 },
  { id: "AUD-004", timestamp: "2026-06-18 11:30:00", user: "Mercy", action: "INVOICE PROCESSED", document_ref: "INV-2026-002", details: "Uploaded and processed DHL Express Kenya Invoice (DHL-112233) for USD 9,860. Applied exchange rate 129.50.", amount: 1276870 },
  { id: "AUD-005", timestamp: "2026-06-19 14:20:00", user: "Harrison", action: "INVOICE APPROVED", document_ref: "INV-2026-002", details: "Approved DHL Express Kenya Invoice (DHL-112233) for Logistics.", amount: 1276870 },
  { id: "AUD-006", timestamp: "2026-06-20 14:00:00", user: "Mercy", action: "INVOICE PROCESSED", document_ref: "INV-2026-003", details: "Uploaded and processed Deloitte Kenya Invoice (DL-554433) for KES 2,900,000.", amount: 2900000 }
]

export const initialDocuments: Document[] = [
  { id: "DOC001", name: "Bayer_Chemical_Invoice_BY-998822.pdf", tag: "invoice", uploaded_by: "Mercy", uploaded_at: "2026-06-15 10:14", size: "420 KB", associated_tx: "INV-2026-001" },
  { id: "DOC002", name: "DHL_Freight_Billing_DHL-112233.pdf", tag: "invoice", uploaded_by: "Mercy", uploaded_at: "2026-06-18 11:28", size: "310 KB", associated_tx: "INV-2026-002" },
  { id: "DOC003", name: "Deloitte_Q2_Consultancy_DL-554433.pdf", tag: "invoice", uploaded_by: "Mercy", uploaded_at: "2026-06-20 13:58", size: "1.2 MB", associated_tx: "INV-2026-003" }
]
