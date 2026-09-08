import { createSupabaseAdminClient } from "@/lib/supabase-server"

/**
 * Brute-force protection for credential checks — see
 * supabase/migrations/20260909140000_add_rate_limiting.sql for why the
 * counter lives in the database rather than in memory.
 *
 * Always call consumeRateLimit() BEFORE checking the credential and
 * clearRateLimit() after a success. Counting first means an attempt still
 * registers if the check throws.
 */

export interface RateLimitRule {
  /** Attempts permitted inside the window before the lock applies. */
  maxAttempts: number
  windowSeconds: number
  lockSeconds: number
}

/** 5 tries, then locked out for 15 minutes. */
export const STRICT_LIMIT: RateLimitRule = { maxAttempts: 5, windowSeconds: 900, lockSeconds: 900 }

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the caller may try again. Only meaningful when blocked. */
  retryAfter: number
}

export async function consumeRateLimit(
  scope: string,
  identifier: string,
  rule: RateLimitRule = STRICT_LIMIT,
): Promise<RateLimitResult> {
  const admin = createSupabaseAdminClient()
  // No admin client means no counter. Failing OPEN here is deliberate: the
  // routes that call this already refuse to do anything useful without the
  // admin client, so a closed failure would just turn a clear "backend not
  // configured" message into a confusing lockout.
  if (!admin) return { allowed: true, retryAfter: 0 }

  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_scope: scope,
    p_identifier: identifier.toLowerCase().slice(0, 200),
    p_max_attempts: rule.maxAttempts,
    p_window_seconds: rule.windowSeconds,
    p_lock_seconds: rule.lockSeconds,
  })

  if (error) {
    // Same reasoning as above — a limiter outage must not lock out the
    // finance manager on payroll day.
    console.error("Rate limit check failed:", error.message)
    return { allowed: true, retryAfter: 0 }
  }

  const row = Array.isArray(data) ? data[0] : data
  return {
    allowed: row?.allowed ?? true,
    retryAfter: row?.retry_after ?? 0,
  }
}

export async function clearRateLimit(scope: string, identifier: string): Promise<void> {
  const admin = createSupabaseAdminClient()
  if (!admin) return
  await admin.rpc("clear_rate_limit", {
    p_scope: scope,
    p_identifier: identifier.toLowerCase().slice(0, 200),
  })
}

/** Human-readable "try again in ..." for an error message. */
export function retryAfterLabel(seconds: number): string {
  if (seconds <= 60) return "in about a minute"
  return `in about ${Math.ceil(seconds / 60)} minutes`
}

/**
 * Best-effort caller IP, used as a second limiter key so one attacker cannot
 * dodge the per-account limit by cycling through email addresses. Vercel sets
 * x-forwarded-for; the first entry is the client.
 */
export function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}
