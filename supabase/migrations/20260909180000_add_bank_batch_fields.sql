-- The bank batch file needs two things per employee that the employees table
-- never held, so the generated file could not match the bank's real layout.
--
--   bank_branch_code — the 5-digit clearing code the bank actually routes on
--                      (e.g. 03095). bank_name was derived from its first two
--                      digits and the code itself then discarded, which threw
--                      away the only part the bank reads.
--   emp_code         — the employee reference the bank file carries
--                      (EMP001...). NOT a sequence: it is the payroll's own
--                      staff code, with gaps where people have left, so it
--                      cannot be generated and has to be stored.
--
-- Both are populated from the finance manager's own November 2024 bank file.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS bank_branch_code varchar;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS emp_code varchar;

COMMENT ON COLUMN public.employees.bank_branch_code IS
  'Bank clearing/branch code used by the bank batch file, e.g. 03095. First two digits identify the bank.';
COMMENT ON COLUMN public.employees.emp_code IS
  'Employee reference carried in the bank batch file (EMP001...). Sourced from payroll, not sequential.';
