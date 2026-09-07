-- The 'employee' role (added in 20260907130000_add_employee_portal_access.sql)
-- was never added to audit_logs_insert's WITH CHECK list, so every portal
-- sign-in fails to write its own "USER SIGN-IN" entry (confirmed live: a
-- 403 + "new row violates row-level security policy for table audit_logs"
-- on the first employee-portal login test). Sign-in is swallowed client-side
-- so it didn't block the login itself, but the audit trail silently lost
-- every employee session.
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager', 'employee'));
