-- Employee email address, needed to auto-send payslips (see
-- app/api/payroll/send-payslips/route.ts). Optional — employees without one
-- on file are simply skipped when sending, not treated as an error.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email text;
