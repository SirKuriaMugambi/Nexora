import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { validateNewPassword } from "@/lib/password-policy"

// Same owner-by-email gate as /api/admin/pending-signups — the person named
// in NEXORA_OWNER_EMAIL, and nobody else, regardless of role.
const OWNER_EMAIL = (process.env.NEXORA_OWNER_EMAIL ?? "").trim().toLowerCase()

async function requireOwner() {
  if (!OWNER_EMAIL) return { ok: false as const, status: 503, error: "NEXORA_OWNER_EMAIL is not configured" }
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { ok: false as const, status: 503, error: "Backend is not configured" }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || (user.email ?? "").toLowerCase() !== OWNER_EMAIL) {
    return { ok: false as const, status: 403, error: "Not authorized" }
  }
  return { ok: true as const, user }
}

export interface StaffAccount {
  id: string
  email: string
  full_name: string | null
  role: string
  otp_verified: boolean
  must_change_password: boolean
  last_sign_in_at: string | null
}

// Every staff (non-employee-portal) account, so the owner can see who can
// sign in and set a temporary password for anyone locked out.
export async function GET() {
  const gate = await requireOwner()
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const admin = createSupabaseAdminClient()
  if (!admin) return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, otp_verified, must_change_password")
    .neq("role", "employee")
    .order("email")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Last sign-in lives on the auth user, not the profile.
  const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 500 })
  const lastSignIn = new Map((usersPage?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]))

  const accounts: StaffAccount[] = (profiles ?? []).map((p) => ({
    id: p.id, email: p.email, full_name: p.full_name ?? null, role: p.role,
    otp_verified: Boolean(p.otp_verified), must_change_password: Boolean(p.must_change_password),
    last_sign_in_at: lastSignIn.get(p.id) ?? null,
  }))
  return NextResponse.json({ accounts })
}

// Set a TEMPORARY password for a staff account. The owner types it and hands
// it over in person; the account is then confined to /change-password until
// the person picks their own. The password never touches the database in
// clear text and is never echoed back.
export async function POST(request: Request) {
  const gate = await requireOwner()
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const admin = createSupabaseAdminClient()
  if (!admin) return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })

  const body = (await request.json().catch(() => ({}))) as { userId?: string; temporaryPassword?: string }
  const userId = (body.userId ?? "").trim()
  const temporaryPassword = body.temporaryPassword ?? ""
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })
  const problem = validateNewPassword(temporaryPassword)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const { data: profile, error: profileError } = await admin
    .from("profiles").select("id, email, role").eq("id", userId).maybeSingle()
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })
  if (!profile) return NextResponse.json({ error: "No such account" }, { status: 404 })
  if (profile.role === "employee") {
    return NextResponse.json({ error: "Employee portal accounts sign in with their KRA PIN, not a password." }, { status: 400 })
  }

  const { error: authError } = await admin.auth.admin.updateUserById(userId, { password: temporaryPassword })
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  const { error: flagError } = await admin.from("profiles").update({ must_change_password: true }).eq("id", userId)
  if (flagError) return NextResponse.json({ error: flagError.message }, { status: 500 })

  await admin.from("audit_logs").insert({
    id: `AUD-${Math.floor(100000 + Math.random() * 900000)}`,
    timestamp: new Date().toISOString(),
    operator_user: gate.user.email ?? "owner",
    action: "STAFF PASSWORD RESET",
    document_ref: profile.email,
    details: `Temporary password set for ${profile.email} by the system owner; they must choose their own at next sign-in.`,
  })

  return NextResponse.json({ ok: true, email: profile.email })
}
