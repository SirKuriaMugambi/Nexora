import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase"
import { createSupabaseAdminClient } from "@/lib/supabase-server"

// The system owner's address, from the environment — the same variable
// proxy.ts and /api/signup-otp/request read.
const OWNER_EMAIL = (process.env.NEXORA_OWNER_EMAIL ?? "").trim().toLowerCase()

// Fallback path to hand out sign-up codes that doesn't depend on
// RESEND_API_KEY being configured — read the pending code directly instead
// of relying on the email in /api/signup-otp/request having arrived.
// Owner-only: checked by email, not role, since this predates whether the
// owner even has a "real" role assigned. With no owner configured there is
// no one this page can belong to, so it is closed rather than open.
export async function GET() {
  if (!OWNER_EMAIL) {
    return NextResponse.json({ error: "NEXORA_OWNER_EMAIL is not configured" }, { status: 503 })
  }

  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || (user.email ?? "").toLowerCase() !== OWNER_EMAIL) {
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
