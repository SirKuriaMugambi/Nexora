import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabase"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { callerIp, clearRateLimit, consumeRateLimit, retryAfterLabel, STRICT_LIMIT } from "@/lib/rate-limit"
import { validateNewPassword } from "@/lib/password-policy"

// A signed-in staff member changes their own password. The current password
// is checked first — a stolen session alone must not be enough to lock the
// real owner out — and both that check and the change are rate-limited like
// every other credential check in the system.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const admin = createSupabaseAdminClient()
  if (!admin) return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })

  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle()
  if (profile?.role === "employee") {
    return NextResponse.json({ error: "Employee portal accounts sign in with their KRA PIN and have no password." }, { status: 400 })
  }

  const body = (await request.json().catch(() => ({}))) as { currentPassword?: string; newPassword?: string }
  const currentPassword = body.currentPassword ?? ""
  const newPassword = body.newPassword ?? ""
  if (!currentPassword) return NextResponse.json({ error: "Enter your current password." }, { status: 400 })
  const problem = validateNewPassword(newPassword, { notEqualTo: currentPassword })
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  // Five wrong current passwords in fifteen minutes locks the attempt, per
  // account and per address.
  const scope = "change-password"
  for (const identifier of [user.id, callerIp(request)]) {
    const limit = await consumeRateLimit(scope, identifier, STRICT_LIMIT)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in about ${retryAfterLabel(limit.retryAfter)}.` },
        { status: 429 },
      )
    }
  }

  // Prove the current password with a throwaway client that keeps no
  // session — this never touches the caller's cookies.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !anonKey) return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  const probe = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: signInError } = await probe.auth.signInWithPassword({ email: user.email, password: currentPassword })
  if (signInError) {
    return NextResponse.json({ error: "The current password is not correct." }, { status: 401 })
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: newPassword })
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  await admin.from("profiles").update({ must_change_password: false }).eq("id", user.id)
  await Promise.all([clearRateLimit(scope, user.id), clearRateLimit(scope, callerIp(request))])

  await admin.from("audit_logs").insert({
    id: `AUD-${Math.floor(100000 + Math.random() * 900000)}`,
    timestamp: new Date().toISOString(),
    operator_user: user.email,
    action: "PASSWORD CHANGED",
    document_ref: user.email,
    details: "Account password changed by its owner.",
  })

  return NextResponse.json({ ok: true })
}
