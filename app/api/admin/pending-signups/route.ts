import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase"
import { createSupabaseAdminClient } from "@/lib/supabase-server"

// Must match proxy.ts's OWNER_EMAIL.
const OWNER_EMAIL = "owner@example.com"

// Fallback path to hand out sign-up codes that doesn't depend on
// RESEND_API_KEY being configured — read the pending code directly instead
// of relying on the email in /api/signup-otp/request having arrived.
// Owner-only: checked by email, not role, since this predates whether the
// owner even has a "real" role assigned.
export async function GET() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== OWNER_EMAIL) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, otp_code, otp_expires_at")
    .eq("otp_verified", false)
    .order("email")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ pending: data ?? [] })
}
