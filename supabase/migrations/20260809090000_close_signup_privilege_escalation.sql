-- Self-service sign-up currently lets a new user pick ANY role — including
-- finance_manager — via raw_user_meta_data, and handle_new_user() trusted it
-- unconditionally. Since payroll/employees API routes gate on
-- requireRole("finance_manager") reading this same profiles.role column,
-- that meant anyone with the sign-up link could self-grant full payroll/PII
-- access. Close it server-side (client-side dropdown removal alone doesn't
-- stop a direct call to supabase.auth.signUp()): every new profile now lands
-- as the lowest-privilege role regardless of what the signup payload claims.
-- Elevating someone to finance_manager (or any other privileged role) is now
-- a manual, out-of-band action by the system owner after verifying identity:
--   update public.profiles set role = 'finance_manager' where email = '...';
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'production_manager'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
