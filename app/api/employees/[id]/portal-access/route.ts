import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"

// Provisions an employee's self-service portal access — the ONLY way an
// employee account gets created; there is no public sign-up path to it.
// There is no password at all: sign-in is email + the last 4 characters of
// the employee's own KRA PIN, already on file below (see
// app/api/portal-login), so there's nothing to generate, show, or relay
// here — just flip the account on.
// Employee portal accounts skip the sign-up OTP gate (otp_verified is set
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
  // Treat a blank email as no email: the Employee Master form writes "" for
  // an empty field, and an empty string would otherwise sail past a plain
  // null check and produce an unusable account nobody can sign in to.
  const email = typeof employee.email === "string" ? employee.email.trim() : ""
  if (!email) {
    return NextResponse.json(
      { error: "This employee has no email on file. Add one in Employee Master first — it's how they'll be identified for their portal login." },
      { status: 400 },
    )
  }

  // Already provisioned. There's no password to reset, but re-run the
  // profile fix-ups so pressing the button again repairs an account whose
  // role or display name drifted — the cheapest recovery path there is.
  if (employee.portal_user_id) {
    await admin
      .from("profiles")
      .update({ role: "employee", otp_verified: true, full_name: employee.name })
      .eq("id", employee.portal_user_id)
    return NextResponse.json({ email, alreadyEnabled: true })
  }

  // An auth account may already exist for this address without the employee
  // row pointing at it — provisioning is several steps (create the account,
  // set its role, link it here), and if any step after the first failed, the
  // account was left orphaned. Retrying then hit "already registered" while
  // signing in hit "no matching record": a dead end with no way out of the
  // UI. So look first, and adopt what's there.
  const { data: existingList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existing = existingList?.users.find(
    (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
  )

  let userId: string
  let adopted = false

  if (existing) {
    // Refuse if it belongs to somebody else — one login cannot serve two
    // employees, and silently re-pointing it would hand this employee the
    // other one's payslips.
    const { data: claimedBy } = await admin
      .from("employees")
      .select("id")
      .eq("portal_user_id", existing.id)
      .maybeSingle()

    if (claimedBy && claimedBy.id !== id) {
      return NextResponse.json(
        {
          error: `That email already has portal access under employee ${claimedBy.id}. Each employee needs their own email address.`,
        },
        { status: 409 },
      )
    }

    // An operator account (finance manager, accountant) must never be
    // demoted to an employee portal login by adding its address here.
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", existing.id)
      .single()

    if (profile && profile.role !== "employee") {
      return NextResponse.json(
        {
          error: `That email is already used by a system operator account (${profile.role.replace(/_/g, " ")}). Use a different address for this employee.`,
        },
        { status: 409 },
      )
    }

    userId = existing.id
    adopted = true
  } else {
    // Fresh provision. No password set at all — this account can only ever
    // sign in with the KRA PIN flow. email_confirm skips Supabase's own
    // confirmation email: this account is finance-manager-vouched, there's
    // nothing to confirm.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
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
    userId = created.user.id
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
  // full_name is set here too, not just on creation: an adopted account may
  // carry the name of whoever it was first provisioned for, and the portal
  // greets the employee by it — showing them somebody else's name.
  const { error: verifyError } = await admin
    .from("profiles")
    .update({ role: "employee", otp_verified: true, full_name: employee.name })
    .eq("id", userId)

  if (verifyError) {
    return NextResponse.json({ error: `Account created but failed to activate it: ${verifyError.message}` }, { status: 500 })
  }

  // The link is written LAST but is what everything else keys off, so if it
  // fails the account is orphaned — which is exactly the state the adoption
  // branch above now recovers from on a retry.
  const { error: linkError } = await admin
    .from("employees")
    .update({ portal_user_id: userId, email })
    .eq("id", id)

  if (linkError) {
    return NextResponse.json({ error: `Account created but failed to link it to the employee record: ${linkError.message}` }, { status: 500 })
  }

  return NextResponse.json({ email, alreadyEnabled: false, adopted })
}
