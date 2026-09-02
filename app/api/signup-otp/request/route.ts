import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { sendSignupOtpEmail, isEmailConfigured } from "@/lib/email"
import { randomInt } from "crypto"

// Must match proxy.ts's OWNER_EMAIL — kept as a separate constant rather
// than importing across the middleware/route boundary. This is the ONLY
// address the code is ever sent to; the person signing up never sees it.
const OWNER_EMAIL = "owner@example.com"
const CODE_TTL_MS = 15 * 60 * 1000

// Generates a fresh 6-digit code for the CURRENTLY AUTHENTICATED session
// and emails it to the owner. Called right after sign-up, and again if the
// user asks to resend — operates on whoever's session cookie is present,
// never on a client-supplied email, so it can't be used to spam OTPs at an
// arbitrary address.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, email, otp_verified")
    .eq("id", user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 })
  }
  if (profile.otp_verified) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }

  // The code is generated and stored FIRST, unconditionally — this must
  // never depend on email being configured, since /admin/pending-signups
  // is the fallback for exactly that case (RESEND_API_KEY not set yet, or
  // the send failing for any other reason). Checking isEmailConfigured()
  // before this point was the original version of this route and meant no
  // code ever got stored at all when email wasn't set up — the fallback
  // page had nothing to show. Caught by testing the flow end-to-end rather
  // than trusting the code by inspection.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()

  const { error: updateError } = await admin
    .from("profiles")
    .update({ otp_code: code, otp_expires_at: expiresAt })
    .eq("id", user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({
      ok: true,
      expiresAt,
      emailSent: false,
      note: "Email isn't configured yet — check /admin/pending-signups for the code instead.",
    })
  }

  const result = await sendSignupOtpEmail({
    ownerEmail: OWNER_EMAIL,
    newUserName: profile.full_name ?? profile.email,
    newUserEmail: profile.email,
    code,
  })

  // Same principle even once email IS configured: a delivery failure (bad
  // API key, Resend outage, spam filter) must not hide the code — it's
  // already safely stored, so report the email problem without erroring
  // the whole request.
  return NextResponse.json({
    ok: true,
    expiresAt,
    emailSent: result.ok,
    note: result.ok ? undefined : `Code saved, but the email failed to send: ${result.error}. Check /admin/pending-signups instead.`,
  })
}
