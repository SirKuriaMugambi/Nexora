-- Brute-force protection for every credential check in the system.
--
-- Until now nothing counted failed attempts, which mattered most for the
-- employee portal: its credential is the last 4 characters of a KRA PIN, so
-- an attacker who knew a colleague's email address had only a few thousand
-- guesses to make and unlimited time to make them. The module access code is
-- 4 digits and the sign-up approval code is 6, with the same problem.
--
-- Counting has to be shared across server instances, which rules out holding
-- it in memory: the app runs as serverless functions and each request may hit
-- a different one. So the counter lives here, and the whole
-- read-decide-increment cycle happens inside one function under a row lock —
-- otherwise two simultaneous guesses both read the old count and neither
-- trips the limit.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  scope             text        NOT NULL,
  identifier        text        NOT NULL,
  attempts          integer     NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz,
  PRIMARY KEY (scope, identifier)
);

COMMENT ON TABLE public.rate_limits IS
  'Failed-attempt counters for credential checks. Written only by the service-role client from route handlers; no client ever reads or writes it.';

-- Enabled with NO policies at all: that denies every ordinary role outright.
-- The service-role client used by the route handlers bypasses RLS, which is
-- exactly the access this table should have and no more.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits(window_started_at);

/**
 * Records one attempt and says whether it may proceed.
 *
 * Call BEFORE checking the credential, so an attempt is counted even if the
 * process dies midway; call clear_rate_limit() after a success to reset.
 * Returns retry_after in seconds when it refuses, so the caller can tell the
 * user when to come back rather than leaving them guessing.
 */
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_scope           text,
  p_identifier      text,
  p_max_attempts    integer,
  p_window_seconds  integer,
  p_lock_seconds    integer
)
RETURNS TABLE (allowed boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_row public.rate_limits%ROWTYPE;
BEGIN
  INSERT INTO public.rate_limits (scope, identifier, attempts, window_started_at)
  VALUES (p_scope, p_identifier, 0, v_now)
  ON CONFLICT (scope, identifier) DO NOTHING;

  -- FOR UPDATE: serialises concurrent guesses against the same identifier.
  SELECT * INTO v_row FROM public.rate_limits
   WHERE scope = p_scope AND identifier = p_identifier
   FOR UPDATE;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > v_now THEN
    RETURN QUERY SELECT false, CEIL(EXTRACT(EPOCH FROM (v_row.locked_until - v_now)))::integer;
    RETURN;
  END IF;

  -- A finished lock, or a stale window, starts the count over.
  IF v_row.locked_until IS NOT NULL
     OR v_row.window_started_at < v_now - make_interval(secs => p_window_seconds) THEN
    UPDATE public.rate_limits
       SET attempts = 1, window_started_at = v_now, locked_until = NULL
     WHERE scope = p_scope AND identifier = p_identifier;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  IF v_row.attempts + 1 > p_max_attempts THEN
    UPDATE public.rate_limits
       SET attempts = v_row.attempts + 1,
           locked_until = v_now + make_interval(secs => p_lock_seconds)
     WHERE scope = p_scope AND identifier = p_identifier;
    RETURN QUERY SELECT false, p_lock_seconds;
    RETURN;
  END IF;

  UPDATE public.rate_limits
     SET attempts = v_row.attempts + 1
   WHERE scope = p_scope AND identifier = p_identifier;
  RETURN QUERY SELECT true, 0;
END;
$function$;

/** Wipes the counter after a correct credential, so honest users never accumulate. */
CREATE OR REPLACE FUNCTION public.clear_rate_limit(p_scope text, p_identifier text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.rate_limits WHERE scope = p_scope AND identifier = p_identifier;
$function$;

-- These run only via the service-role client; no other role may execute them.
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, text, integer, integer, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_rate_limit(text, text) FROM public, anon, authenticated;
