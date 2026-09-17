# Nexora — Payroll & PAYE Automation

**Pilot module of the Nexora finance-operations platform, built for Chrysal Africa Ltd**

Nexora Payroll replaces the monthly payroll spreadsheet with a controlled, auditable system. In a single run it computes every Kenyan statutory deduction for all 46 Chrysal Africa employees, routes the result through a submit-and-approve workflow, and generates the files finance currently assembles by hand each month — the Dynamics AX journal upload, the bank salary file, employee payslips and the PAYE return — plus annual P9 tax cards. The calculation engine was built from, and reconciled to the cent against, the finance manager's own payroll workbook.

The module is deployed to production and holds the August 2026 payroll run.

| | |
|---|---|
| **Live at** | https://fin-ops-ai-phi.vercel.app — Payroll & PAYE, Employee Master, Employee Portal |
| **Built for** | Chrysal Africa Ltd, Nairobi — 46 employees across 6 cost centres |
| **Scope** | Kenyan statutory payroll: PAYE, NSSF, SHIF, Affordable Housing Levy, pension, NITA |
| **Verification** | Reconciled to the cent against the finance manager's workbook, all 46 employees · 122 automated tests |
| **Stack** | Next.js 16 · TypeScript · Supabase (Postgres) · Vercel |
| **Integrations** | Microsoft Dynamics AX journal · bank salary upload · KRA (PAYE return, P9) · email delivery |

---

## What the payroll module does

### 1. Statutory calculation engine

For each employee, from basic pay and the month's variable inputs (bonus/commission, transport allowance, arrears, overtime, non-cash benefits, advances, company and bank loans, HELB, SACCO, voluntary pension), the engine computes:

| Item | Rule applied |
|---|---|
| **PAYE** | KRA graduated monthly bands (10% – 35%), personal relief and applicable reliefs |
| **NSSF** | Tier I and Tier II under the NSSF Act 2013, employee and employer |
| **SHIF** | 2.75% Social Health Insurance Fund contribution (successor to NHIF) |
| **Affordable Housing Levy** | 1.5% employee contribution, matched by the employer |
| **Pension** | Employee contribution subject to the statutory tax-deductible cap; employer contribution |
| **NITA** | Employer industrial training levy per employee |
| **Net pay** | Gross less all statutory and voluntary deductions; non-cash benefits are taxed but not paid out |

**Rules are effective-dated.** Separate rule cards exist for 2024, 2025 (Tax Laws (Amendment) Act 2024 — SHIF and housing levy deductibility, revised pension cap, NSSF Year 3 limits) and 2026 (NSSF Year 4 limits). The engine selects the card in force for the pay month being run, so a statutory change is a configuration entry rather than a code change, and any historical month recomputes under the rules that applied at the time. SHIF, housing levy and pension are computed on the basis used in the company's existing payroll workbook, with a single company-wide switch to change that basis.

**Per-employee arrangements are explicit.** Staff outside the pension scheme, expatriate relief arrangements and specific NSSF or PAYE treatments the company already operates are held as named exceptions on the employee record and shown as labelled chips in Employee Master — nothing is buried inside a formula.

### 2. Bulk monthly processing

One action computes and saves the entire company. Variable pay can be typed into the register or uploaded from the finance team's Excel template; uploads are previewed (matched, unmatched and skipped rows) before anything is written.

### 3. Pre-flight validation

Every employee is checked before a run is saved. A missing KRA PIN, zero basic pay or negative net pay blocks the run; missing bank details, missing bank routing codes, duplicate bank references or a missing email are raised as warnings. Each issue links to the exact field in Employee Master that resolves it.

### 4. Approval workflow

`Draft → Submitted → Approved → Posted`, with `Rejected` returning a run for correction. A draft can be recomputed freely; once submitted, the figures are locked. Every output below requires an approved run, and an approved run is immutable — it is the audit record.

### 5. Outputs

| Output | Format | Detail |
|---|---|---|
| **Dynamics AX journal** | .xlsx | Chrysal's exact AX upload layout — voucher, account strings, cost-centred expense lines, bank block. Balanced by construction; the system refuses to produce a journal that does not balance. |
| **Bank salary file** | .xlsx | The bank's own header / debit / detail / trailer record layout, with branch codes and employee references. |
| **Payslips** | PDF · email | Chrysal's payslip layout; one file per employee or a combined file; emailed to every employee in one action. |
| **P9 tax deduction cards** | PDF / ZIP · email | Annual per-employee card built from every approved run in the year. |
| **PAYE return export** | CSV | Per-employee figures for the monthly KRA return. |
| **Statutory & cost-centre summary** | On screen · CSV | Totals by deduction and by cost centre — cash and non-cash cost, headcount — including shared-services staff allocated across centres. |

### 6. Employee self-service portal

Each employee can be given portal access from Employee Master. They sign in with their email and the last four characters of their own KRA PIN — no passwords to issue or reset — and see only their own payslips and P9 cards.

### 7. Employee Master

The single source of employee data: pay and monthly inputs, statutory identifiers (KRA PIN, national ID, SHA), cost centre and department, bank details and bank-file references, portal access, and the named statutory exceptions. A companion Staff Documents store holds contracts, identity documents, certificates and HR records against each employee.

### 8. Access control and audit

Payroll, Employee Master and Staff Documents are restricted to the Finance Manager role, enforced on the server for every request, with a second unlock code on the module itself. Employee portal accounts are fenced to their own data. Every sign-in and every change is written to an append-only audit trail, and all credential checks are rate-limited.

---

## How a month runs

1. Update variable pay — in the register or by Excel upload — and clear any pre-flight issues.
2. **Run Payroll.** The engine computes all employees and saves a draft.
3. **Submit for approval.** The Finance Manager approves, or rejects with a reason.
4. Download the AX journal and the bank salary file; generate and email payslips.
5. Export the PAYE return. At year-end, issue P9 cards.

---

## Verification and testing

- The engine was built from the finance manager's own payroll workbook and reconciled to the cent across all 46 employees, including every per-employee exception in that workbook.
- 122 automated tests across 12 suites cover the statutory engine, the rule cards, cost allocation, the AX journal (including a proof that it balances for any headcount), the bank file, P9 generation, Excel import and pre-flight validation. They run without the interface or a database.
- All arithmetic is carried at full precision and rounded once, at output, matching spreadsheet behaviour exactly.

---

## Deployment

Nexora is deployed on Vercel at **https://fin-ops-ai-phi.vercel.app**, backed by a Supabase Postgres database. Staff sign in at `/sign-in` with a corporate email and password; new accounts are activated with a code issued by the system owner. Employees sign in at `/employee-login`. The Payroll & PAYE and Employee Master modules are live in this deployment and hold the August 2026 payroll run.

---

## Technology stack

| Layer | Technology |
|---|---|
| Application | Next.js 16 (App Router), React 19, TypeScript 5 |
| Interface | Tailwind CSS 4, Radix UI |
| Database & authentication | Supabase — Postgres with row-level security, Supabase Auth, Supabase Storage |
| Documents | jsPDF (payslips, P9 cards), SheetJS (AX journal, bank file, Excel import), JSZip |
| Email delivery | Resend |
| ERP | Microsoft Dynamics AX / D365FO — journal upload file today; OData posting client in place for direct posting once an AX app registration is provisioned |
| Testing | Jest — 122 tests |
| Hosting | Vercel |

---

## The wider Nexora platform

Payroll & PAYE is the pilot. Nexora is designed as an 18-module finance-operations suite for Chrysal Africa, behind one login, one role model and one audit trail:

| Area | Modules |
|---|---|
| Overview | Dashboard · Month-End Close · Audit Trail |
| Accounts Payable | Invoice Processing (VAT / WHT validation) · 3-Way Matching · AP Reconciliation · WHT Calculator · Vendor Master |
| Accounts Receivable | AR Receipting |
| Reconciliations | Bank Reconciliation · Intercompany (Chrysal BV) |
| Operations & Reports | **Payroll & PAYE — live pilot** · **Employee Master — live** · Budget vs Actual · Financial Statements · Cash Flow Forecaster · Document Store · Staff Documents |
| System | Chart of Accounts |

Invoice Processing, the WHT Calculator, AP Reconciliation, the Document Store and the Audit Trail already run on the same database. The remaining modules are in place as working prototypes, to be brought live the same way once payroll is signed off.

---

## Repository structure

```
app/(workspace)/payroll/       Payroll & PAYE screens
app/(workspace)/employees/     Employee Master
app/my-portal/                 Employee self-service portal
app/api/payroll/               Run, workflow, AX journal, bank file, payslips, P9, PAYE export, import
lib/payroll-rules-config.ts    Effective-dated statutory rule cards
lib/payroll-engine.ts          Statutory calculation engine
lib/ax-journal-builder.ts      Dynamics AX journal
lib/bank-batch-builder.ts      Bank salary file
lib/p9-builder.ts              P9 tax deduction cards
lib/payroll-validation.ts      Pre-flight checks
lib/__tests__/                 Automated tests
supabase/migrations/           Database schema
```

## Running locally

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # runs the 122 tests
```

Requires a `.env.local` with the Supabase project URL and keys.
