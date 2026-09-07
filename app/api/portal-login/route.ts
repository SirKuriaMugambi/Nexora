import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"

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

  return NextResponse.json({ ok: true, hashed_token: linkData.properties.hashed_token })
}
