-- Owner-approval gate for new sign-ups: an account exists in auth.users the
-- moment someone signs up (unchanged), but can't be USED until they enter a
-- one-time code that only the system owner receives (by email, to
-- owner@example.com) and hands over manually. See app/api/signup-otp/*
-- and proxy.ts for enforcement.
--
-- Existing accounts must not be locked out by this — default TRUE backfills
-- every current row, then the column default flips to FALSE so every row
-- created from this point on requires verification.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS otp_verified boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ALTER COLUMN otp_verified SET DEFAULT false;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS otp_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS otp_expires_at timestamptz;
