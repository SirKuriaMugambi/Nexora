import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"
import { randomBytes } from "crypto"

// Generates a random, readable-enough-to-relay-verbally password —
// 12 characters, mixed case + digits, no ambiguous-looking characters
// (0/O, 1/l/I) since this gets read aloud or typed from a screenshot.
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  const bytes = randomBytes(12)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
}

// Provisions (or resets) an employee's self-service portal login — the
// ONLY way an employee account gets created; there is no public sign-up
// path to it. Deliberately mirrors how every admin-set password this
// session has worked: generated here, returned once in the response,
// never emailed — the finance manager relays it directly. Employee
// portal accounts also skip the sign-up OTP gate (otp_verified is set
// true immediately) since they were never a public self-signup in the
// first place, and are exempted from the eval-access cutoff in proxy.ts.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { id } = await params
  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, name, email, portal_user_id")
    .eq("id", id)
    .single()

  if (employeeError || !employee) {
    return NextResponse.json({ error: `Employee "${id}" not found.` }, { status: 404 })
  }
  if (!employee.email) {
    return NextResponse.json(
      { error: "This employee has no email on file. Add one in Employee Master first — it's how they'll be identified for their portal login." },
      { status: 400 },
    )
  }

  const password = generatePassword()

  // Existing account: this is a reset, not a fresh provision — just set a
  // new password, everything else (role, the portal_user_id link) is
  // already correct.
  if (employee.portal_user_id) {
    const { error: updateError } = await admin.auth.admin.updateUserById(employee.portal_user_id, { password })
    if (updateError) {
      return NextResponse.json({ error: `Failed to reset password: ${updateError.message}` }, { status: 500 })
    }
    return NextResponse.json({ email: employee.email, password, reset: true })
  }

  // Fresh provision. email_confirm skips Supabase's own confirmation email —
  // this account is finance-manager-vouched, there's nothing to confirm.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: employee.email,
    password,
    email_confirm: true,
    // NOT role — the profile trigger ignores it (see below); setting it
    // here would be a no-op that misleadingly implies otherwise.
    user_metadata: { full_name: employee.name },
  })

  if (createError || !created.user) {
    return NextResponse.json(
      { error: `Failed to create portal account: ${createError?.message ?? "unknown error"}` },
      { status: 500 },
    )
  }

  // handle_new_user() (see supabase/migrations/20260809090000_close_signup_
  // privilege_escalation.sql) hardcodes every new profile to role=
  // 'production_manager' regardless of what's in user_metadata — deliberate,
  // to close a self-service role-escalation hole on public sign-up. That
  // means role is NOT already 'employee' here despite passing it in
  // createUser's metadata above; it must be set explicitly, same as
  // otp_verified below (which defaults to false for every new signup,
  // correct for public sign-up, wrong here: this account was provisioned by
  // the finance manager, not self-registered, so it must not be stuck
  // behind a code nobody will ever send it). Caught by testing the actual
  // account's role after creation, not by trusting the trigger's old
  // documented behavior.
  const { error: verifyError } = await admin
    .from("profiles")
    .update({ role: "employee", otp_verified: true })
    .eq("id", created.user.id)

  if (verifyError) {
    return NextResponse.json({ error: `Account created but failed to activate it: ${verifyError.message}` }, { status: 500 })
  }

  const { error: linkError } = await admin
    .from("employees")
    .update({ portal_user_id: created.user.id })
    .eq("id", id)

  if (linkError) {
    return NextResponse.json({ error: `Account created but failed to link it to the employee record: ${linkError.message}` }, { status: 500 })
  }

  return NextResponse.json({ email: employee.email, password, reset: false })
}
