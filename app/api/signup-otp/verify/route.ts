import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { clearRateLimit, consumeRateLimit, retryAfterLabel } from "@/lib/rate-limit"

// Verifies the code for the CURRENTLY AUTHENTICATED session against what
// was stored by /api/signup-otp/request. On success, clears the code (so it
// can't be replayed) and flips otp_verified — proxy.ts's gate checks that
// flag on every request to decide whether this account can use the app.
//
// Limited to 5 attempts per account per 15 minutes (see lib/rate-limit.ts),
// which is what makes the 6-digit code meaningful rather than merely a speed
// bump for a script.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { code?: string }
  const submitted = (body.code ?? "").trim()
  if (!submitted) {
    return NextResponse.json({ error: "code is required" }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const limit = await consumeRateLimit("signup-otp", user.id)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many incorrect codes. Try again ${retryAfterLabel(limit.retryAfter)}.` },
      { status: 429 },
    )
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("otp_code, otp_expires_at, otp_verified")
    .eq("id", user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 })
  }
  if (profile.otp_verified) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }
  if (!profile.otp_code || !profile.otp_expires_at) {
    return NextResponse.json({ error: "No code has been requested for this account yet." }, { status: 400 })
  }
  if (new Date(profile.otp_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 400 })
  }
  if (submitted !== profile.otp_code) {
    return NextResponse.json({ error: "Incorrect code." }, { status: 403 })
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ otp_verified: true, otp_code: null, otp_expires_at: null })
    .eq("id", user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  await clearRateLimit("signup-otp", user.id)
  return NextResponse.json({ ok: true })
}
