import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { callerIp, clearRateLimit, consumeRateLimit, retryAfterLabel } from "@/lib/rate-limit"

// Unauthenticated by design (see proxy.ts's PUBLIC_PATHS) -- this is the
// employee portal's only entry point, no session and no password involved
// at any point. The credential is the same one Tony already hands
// employees every month to open their emailed payslip PDF: the last 4
// characters of their own KRA PIN, already on file in Employee Master --
// nothing new to distribute, nothing for the finance manager to relay.
export async function POST(request: Request) {
  const { email, pin4 } = await request.json().catch(() => ({ email: null, pin4: null }))
  if (!email || !pin4 || typeof email !== "string" || typeof pin4 !== "string") {
    return NextResponse.json({ error: "Enter your email and the last 4 digits of your KRA PIN." }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  // The credential here is only 4 characters, so without a limit it is
  // guessable in minutes by anyone who knows the email address. Counted
  // against the address AND the caller's IP: the first stops one account
  // being ground down, the second stops one attacker working through a list
  // of addresses.
  const ip = callerIp(request)
  for (const [scope, key] of [["portal-login", email.trim()], ["portal-login-ip", ip]] as const) {
    const limit = await consumeRateLimit(scope, key)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again ${retryAfterLabel(limit.retryAfter)}.` },
        { status: 429 },
      )
    }
  }

  const { data: employee } = await admin
    .from("employees")
    .select("id, email, kra_pin")
    .ilike("email", email.trim())
    .not("portal_user_id", "is", null)
    .single()

  const invalid = { error: "That email and KRA PIN combination doesn't match our records." }

  if (!employee || !employee.kra_pin) {
    return NextResponse.json(invalid, { status: 401 })
  }

  const expected = String(employee.kra_pin).trim().slice(-4).toUpperCase()
  const submitted = pin4.trim().toUpperCase()
  if (expected.length !== 4 || submitted !== expected) {
    return NextResponse.json(invalid, { status: 401 })
  }

  // No password exists on this account at all -- generateLink mints a
  // one-time token without sending anything (no email, no SMS); our own
  // check above is the actual gate, this is purely how the session gets
  // issued afterward.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: employee.email as string,
  })

  if (linkError || !linkData.properties?.hashed_token) {
    return NextResponse.json({ error: `Failed to sign you in: ${linkError?.message ?? "unknown error"}` }, { status: 500 })
  }

  // Correct credential — reset both counters so an employee who fumbled a
  // couple of times isn't carrying strikes into next month.
  await clearRateLimit("portal-login", email.trim())
  await clearRateLimit("portal-login-ip", ip)

  return NextResponse.json({ ok: true, hashed_token: linkData.properties.hashed_token })
}
