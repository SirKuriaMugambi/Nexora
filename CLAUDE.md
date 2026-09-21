@AGENTS.md

# Nexora — developer notes

Next.js 16 + Supabase finance-operations platform for Chrysal Africa Ltd.
The Payroll & PAYE module is the live pilot; see `README.md` for what it
does and `BACKEND_IMPLEMENTATION.md` for the database design and role model.
Everything lives inside this one Next.js app — there is no separate service.

## Where things are

```
lib/
  payroll-rules-config.ts   Effective-dated statutory rule cards (2024, 2025, 2026).
                            rulesForMonth("YYYY-MM") picks the card; computePayroll
                            REQUIRES one — there is no default year.
  payroll-engine.ts         computePayroll(inputs, rules); GL summary, cost-centre
                            breakdown (handles fractional cost_centre_allocation),
                            variance report, register CSV.
  payroll-validation.ts     Pre-flight checks (3 blocking, 4 warnings), each linked to
                            the Employee Master field that fixes it.
  employee-exceptions.ts    Labels for the five per-employee statutory overrides.
  cost-allocation.ts        AX dimensions; proportional split across cost centres.
  gl-accounts-config.ts     AX_JOURNAL_ACCOUNTS — the full account strings from the
                            finance manager's real AX upload. PAYROLL_GL_ACCOUNTS is the
                            older map still used by journal-builder.ts.
  ax-journal-builder.ts     The AX upload workbook in the finance manager's exact layout.
                            Refuses if the rounding line exceeds MAX_ROUNDING_ADJUSTMENT.
  journal-builder.ts        The earlier generic Dr/Cr CSV journal (kept until retired).
  dynamics-ax-client.ts     OAuth2 + OData posting; self-mocking (isMock: true) when the
                            DYNAMICS_AX_* variables are unset.
  bank-batch-builder.ts     The bank's 4-record-type salary file. The company account
                            number is passed in from the environment, never stored here.
  p9-builder.ts             Annual P9A cards → PDF.
  payroll-backend.ts        Payslip PDF layout, run workbook export.
  itax-export-builder.ts    PAYE return CSV.
  excel-ingest.ts           Header-driven parsing of the monthly variable-pay workbook.
                            Captures every variable-pay column the sheet carries
                            (row.variable, keyed by category); absent columns stay absent.
  variable-pay.ts           The variable-pay categories (= the engine's variable inputs),
                            header aliases, applyVariablePay(), variablePayChanges().
  variable-pay-store.ts     Server side: applyUploadToMonth() stores only deviations from
                            Employee Master; monthLockState() — locked once the run is
                            Submitted/Approved/Posted.
  email.ts                  Resend wrappers (payslips, P9s, sign-up codes).
  rate-limit.ts             DB-backed brute-force protection for every credential check.
  supabase.ts               requireRole() / requireEmployeeSelf() — the real access gate.
  __tests__/                Jest. Run `npm test`; it needs no UI and no database.

app/api/payroll/            route.ts (GET preview, POST run → Draft), submit, approve,
                            reject, post (→ AX), ax-journal, gl-journal, bank-batch,
                            payslips, send-payslips, p9, send-p9, itax-export, import.
app/api/employees/          Employee Master CRUD + portal provisioning.
app/api/variable-pay/       GET month ledger, PUT one override (null = back to standard),
                            apply/ (POST a previewed sheet). GET /api/payroll applies the
                            month's ledger and returns variable_pay_changes per employee.
app/api/my/                 Employee self-service — scoped to the caller's own record.
app/(workspace)/payroll/    Payroll UI (Register · Statutory · AX GL Posting · Calculator).
app/(workspace)/employees/  Employee Master. Reads ?edit=<id>&field=<name> and
                            ?add=<id>&name=&basic= deep links from pre-flight and import.
app/(workspace)/variable-pay/ Monthly variable-pay ledger: upload → preview → apply, grid
                            of employee × category with click-to-edit, change filters.
proxy.ts                    Next.js 16 middleware: session refresh, public paths, OTP gate,
                            employee-role fencing, evaluation cutoff.
supabase/migrations/        Schema history. schema.sql is a snapshot and may lag.
```

## Working loop

```bash
npm run dev          # http://localhost:3000
npx tsc --noEmit     # type-check
npm test             # Jest — lib/__tests__/**
npm run build        # what Vercel runs
```

- The dev server talks to the **production** Supabase database. Every test
  row you create is real — clean it up.
- Pushes to `master` build a Vercel *Preview*. Someone must "Promote to
  Production" in the Vercel dashboard for a change to go live.
- Read `.env.local` for variable names only; never print values.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase browser/server client |
| `SERVICE_ROLE_KEY` | Admin client for the payroll/employee routes (bypasses RLS — `requireRole()` is the gate) |
| `DATABASE_URL` | Direct Postgres connection for scripts |
| `BANK_BATCH_COMPANY_ACCOUNT` | The company account the bank debits, written to the salary file's debit record. The route returns 503 without it. |
| `NEXORA_OWNER_EMAIL` | Where sign-up approval codes are emailed; who may open `/admin/pending-signups`; the contact on `/access-ended` |
| `NEXORA_EVAL_EXEMPT_EMAILS` | Comma-separated accounts exempt from the evaluation cutoff in `proxy.ts`. The cutoff is only armed when this is set. |
| `RESEND_API_KEY`, `PAYSLIP_FROM_EMAIL` | Email delivery (optional — sending is skipped with a clear note when unset) |
| `DYNAMICS_AX_BASE_URL`, `DYNAMICS_AX_AUTH_URL`, `DYNAMICS_AX_TENANT_ID`, `DYNAMICS_AX_CLIENT_ID`, `DYNAMICS_AX_CLIENT_SECRET` | Live AX posting. All five required; otherwise the client mocks. |
| `DYNAMICS_AX_RESOURCE`, `DYNAMICS_AX_JOURNAL_ENTITY`, `DYNAMICS_AX_JOURNAL_LINE_ENTITY`, `DYNAMICS_AX_LEGAL_ENTITY` | Optional AX overrides (defaults: base URL, `GeneralJournalHeaders`, `GeneralJournalLines`, `CHAF`) |

## Changing statutory rules

1. **A rate, band or limit changes** (new PAYE bands, an NSSF step-up, a
   pension cap): add a new card to `KENYA_PAYROLL_RULE_CARDS` in
   `lib/payroll-rules-config.ts` with the `effectiveFrom` month. Never edit
   an existing card's figures — earlier months must keep recomputing under
   the rules that applied to them. Do not put rates in `payroll-engine.ts`.
2. **A new deduction type entirely**: add its rate to the card interface and
   every card, add the computation to `computePayroll()` following the
   existing pattern (note which base it uses — basic vs. gross matters),
   decide whether it gets its own line in `ax-journal-builder.ts`, and add
   a hand-computed test case to `lib/__tests__/payroll-engine.test.ts`.
3. **A new GL account**: add it to `AX_JOURNAL_ACCOUNTS` in
   `lib/gl-accounts-config.ts`, wire it into `ax-journal-builder.ts`, and
   extend the balance test in `lib/__tests__/ax-journal-builder.test.ts` —
   an unbalanced journal is a hard failure.
4. **A per-employee exception** (someone whose treatment differs from the
   standard rule): it is a column on `public.employees`, an optional field
   on `PayrollInputs`, and an entry in `EXCEPTION_KINDS` so Employee Master
   can label it. Never encode an individual's arrangement in the engine.

## Access model

- Staff sign in at `/sign-in` (email + password). New accounts are frozen
  until they enter a code sent only to `NEXORA_OWNER_EMAIL`.
- Lost password: the owner sets a temporary one from `/admin/pending-signups`
  (Staff accounts → `POST /api/admin/staff-accounts`), hands it over in
  person, and `profiles.must_change_password` confines that account to
  `/change-password` (`POST /api/account/password`, current password
  required, rate-limited) until it picks its own. Nothing is emailed.
  `lib/password-policy.ts` is the one rule both doors apply.
- Employees sign in at `/employee-login` (email + last 4 of their KRA PIN),
  and can reach only `/my-portal` and `/api/my/*` — enforced in `proxy.ts`.
- Payroll, Variable Pay, Employee Master and Staff Documents are `finance_manager`-only,
  checked server-side on every route. The module-unlock code on top is a
  UI convenience, not the security boundary.
