-- Variable pay as a managed monthly ledger.
--
-- Until now a month's variable pay (bonuses, overtime, arrears, advances…)
-- existed only inside the browser between "upload the sheet" and "save the
-- run": the parsed values were merged into the on-screen register and then
-- baked into payroll_register_entries. Nothing recorded WHAT varied from the
-- employee's standard pay, or let the finance manager review or correct it
-- before running.
--
-- One row here = one employee, one month, one category, and the amount that
-- applies for that month INSTEAD of the Employee Master value. Only real
-- deviations are stored — a row is created when the month's figure differs
-- from the standard one — so the table reads as exactly "what changed this
-- month", which is what the finance manager wants to see against each name.
--
-- Categories are the payroll engine's own variable input fields (see
-- lib/variable-pay.ts); a category the engine does not know cannot be stored.
CREATE TABLE IF NOT EXISTS public.variable_pay (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month        text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  employee_id  text NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN (
                 'bonus_commission', 'arrears', 'ot_other', 'transport_allowance',
                 'fringe_benefit', 'voluntary_pension', 'advances', 'helb',
                 'company_loan', 'bank_loan', 'sacco')),
  amount       numeric(14, 2) NOT NULL DEFAULT 0,
  note         text,
  -- 'upload' = came from the month's variable-pay sheet; 'manual' = typed in.
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('upload', 'manual')),
  source_file  text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, employee_id, category)
);

CREATE INDEX IF NOT EXISTS variable_pay_month_idx ON public.variable_pay (month);

COMMENT ON TABLE public.variable_pay IS
  'Per-month overrides of an employee''s standard (Employee Master) pay, one row per category that differs. Absent row = standard value applies.';

-- Same access shape as payroll_register_entries: salary data, finance roles only.
ALTER TABLE public.variable_pay ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "variable_pay_select" ON public.variable_pay;
CREATE POLICY "variable_pay_select" ON public.variable_pay
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager', 'business_controller'));

DROP POLICY IF EXISTS "variable_pay_write" ON public.variable_pay;
CREATE POLICY "variable_pay_write" ON public.variable_pay
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('senior_accountant', 'finance_manager'))
  WITH CHECK (public.get_user_role() IN ('senior_accountant', 'finance_manager'));
