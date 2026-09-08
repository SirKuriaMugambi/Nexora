-- Closes a set of read holes found while auditing what a signed-in account
-- can reach through Supabase's REST API DIRECTLY, without going through this
-- app at all.
--
-- This distinction is the whole point. proxy.ts and the requireRole() checks
-- in the route handlers guard the Next.js app, and they work — but the
-- browser holds a Supabase session token, and Supabase's own API answers
-- that token whether or not the request came from our app. For anything
-- reachable that way, RLS is the only control that exists.
--
-- Seven tables were readable by ANY authenticated account, employee-portal
-- logins included:
--
--   profiles              — including otp_code (see below)
--   audit_logs            — every action, operator name and amount
--   vendors               — including bank_account, a fraud target
--   invoices, budgets, gl_accounts, reconciliation_ledger, checklist_items
--
-- The profiles one was the serious one. It made the owner-approval gate on
-- sign-up bypassable end to end: sign up, ask for a code, then read your own
-- otp_code straight out of profiles and post it back to
-- /api/signup-otp/verify. The account verifies itself, the owner never
-- approves anything, and it lands with the production_manager role that the
-- handle_new_user() trigger assigns. The eval-access cutoff in proxy.ts does
-- not help here either — it guards the app, not the REST API — so the
-- account still reads every table above.
--
-- employees, payroll_runs, payroll_register_entries and the staff documents
-- were already correctly restricted to finance_manager and are unchanged.

-- ── An unapproved account now has no role at all ───────────────────────────
-- handle_new_user() stamps every public sign-up with 'production_manager'
-- before anyone has approved it — deliberately, so the owner-approval gate
-- rather than the role is what admits people. But get_user_role() returned
-- that role regardless of otp_verified, and RLS asks only for the role. So an
-- unapproved sign-up could still read vendor bank details, invoices, budgets
-- and the audit trail straight from the REST API. proxy.ts's gate does not
-- reach that far: it guards the app, not the database.
--
-- Making the function verification-aware fixes it for every policy at once,
-- present and future, instead of adding an otp_verified clause to each one
-- and hoping the next policy remembers. An unverified account resolves to
-- NULL, and NULL matches no role test.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role FROM public.profiles
  WHERE id = auth.uid() AND otp_verified IS TRUE;
$function$;

-- ── profiles ───────────────────────────────────────────────────────────────
-- Own row only; finance_manager may see everyone (the admin screens use the
-- service-role client and are unaffected either way).
DROP POLICY IF EXISTS "profiles_select_all_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.get_user_role() = 'finance_manager');

-- Belt and braces on the code itself: RLS filters rows, not columns, so even
-- own-row access would still hand an unverified account its own pending
-- code. Column privileges close that; the service-role client bypasses these
-- and continues to read the code for verification.
-- A column-level REVOKE is a no-op while a table-level SELECT grant stands,
-- so the table grant is withdrawn and re-issued column by column. Everything
-- the app actually reads is listed; the two OTP columns are not. The
-- service-role client ignores grants entirely and still verifies codes.
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, email, full_name, role, created_at, otp_verified)
  ON public.profiles TO authenticated;
REVOKE SELECT ON public.profiles FROM anon;

-- ── Everything a portal account has no business reading ────────────────────
-- Operator roles only. 'employee' is deliberately absent from every list.
DROP POLICY IF EXISTS "audit_logs_select_all_authenticated" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select" ON public.audit_logs;
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager', 'business_controller'));

DROP POLICY IF EXISTS "vendors_select_all_authenticated" ON public.vendors;
DROP POLICY IF EXISTS "vendors_select" ON public.vendors;
CREATE POLICY "vendors_select" ON public.vendors
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager', 'business_controller'));

DROP POLICY IF EXISTS "Allow authenticated read access" ON public.invoices;
DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager', 'business_controller'));

DROP POLICY IF EXISTS "budgets_select_all_authenticated" ON public.budgets;
DROP POLICY IF EXISTS "budgets_select" ON public.budgets;
CREATE POLICY "budgets_select" ON public.budgets
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager', 'business_controller'));

DROP POLICY IF EXISTS "gl_accounts_select_all_authenticated" ON public.gl_accounts;
DROP POLICY IF EXISTS "gl_accounts_select" ON public.gl_accounts;
CREATE POLICY "gl_accounts_select" ON public.gl_accounts
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager', 'business_controller'));

DROP POLICY IF EXISTS "reconciliation_ledger_select_all_authenticated" ON public.reconciliation_ledger;
DROP POLICY IF EXISTS "reconciliation_ledger_select" ON public.reconciliation_ledger;
CREATE POLICY "reconciliation_ledger_select" ON public.reconciliation_ledger
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager', 'business_controller'));

DROP POLICY IF EXISTS "checklist_items_select_all_authenticated" ON public.checklist_items;
DROP POLICY IF EXISTS "checklist_items_select" ON public.checklist_items;
CREATE POLICY "checklist_items_select" ON public.checklist_items
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager', 'business_controller'));
