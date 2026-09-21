-- Staff password lifecycle without emailed codes.
--
-- The owner can set a TEMPORARY password for a staff account from the admin
-- page (app/api/admin/staff-accounts) and hand it over directly. That marks
-- the profile must_change_password; proxy.ts then lets the account reach
-- only /change-password until the person has chosen their own password
-- (app/api/account/password), which clears the flag.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.must_change_password IS
  'True after the owner sets a temporary password; the account is confined to /change-password until it sets its own.';

-- profiles has column-level SELECT grants (see 20260909100000). proxy.ts reads
-- this flag through the user''s own session, so it must be readable.
GRANT SELECT (must_change_password) ON public.profiles TO authenticated;
