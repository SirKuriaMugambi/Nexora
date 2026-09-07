-- Employee self-service portal: each employee can get their own login,
-- restricted (enforced in proxy.ts, not just hidden nav) to viewing only
-- their own payslips and P9 forms — never anyone else's, never any other
-- module. Accounts are provisioned by the finance manager from Employee
-- Master (a password is generated once and relayed directly), never via
-- public sign-up, so they bypass the sign-up OTP gate entirely (see
-- app/api/employees/[id]/portal-access/route.ts).
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'employee';

-- Links an employee record to the auth account that may view it. NULL =
-- no portal access provisioned yet. UNIQUE so one login can't be attached
-- to two employee records.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS portal_user_id uuid REFERENCES auth.users(id);
CREATE UNIQUE INDEX IF NOT EXISTS employees_portal_user_id_key ON public.employees(portal_user_id) WHERE portal_user_id IS NOT NULL;
