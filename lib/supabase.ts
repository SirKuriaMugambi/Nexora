import { createBrowserClient, createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseAdminClient } from "@/lib/supabase-server"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

let browserClientSingleton: SupabaseClient | null = null

export function createSupabaseBrowserClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  if (!browserClientSingleton) {
    browserClientSingleton = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }

  return browserClientSingleton
}

// Resolves the current authenticated user and their profiles.role in one
// call, for Route Handlers that need to gate an action by role (e.g. only
// finance_manager may approve a payroll run). Returns null if there's no
// authenticated session or Supabase isn't configured.
export async function getAuthedUserWithRole(): Promise<{ id: string; role: string } | null> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return null

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (!profile) return null

  return { id: user.id, role: profile.role as string }
}

// Route Handler guard: requires an authenticated session with one of the
// given roles. Returns { ok: true, user } or { ok: false, status, error } —
// callers should `return NextResponse.json({ error }, { status })` on
// failure. Necessary because the payroll/employees API routes use the
// service-role admin client (createSupabaseAdminClient) to do their actual
// data work, which BYPASSES Postgres RLS entirely — RLS alone does not
// protect these endpoints, this explicit check is the real gate.
export async function requireRole(
  ...roles: string[]
): Promise<{ ok: true; user: { id: string; role: string } } | { ok: false; status: number; error: string }> {
  const authedUser = await getAuthedUserWithRole()
  if (!authedUser) {
    return { ok: false, status: 401, error: "Not authenticated" }
  }
  if (!roles.includes(authedUser.role)) {
    return { ok: false, status: 403, error: "You don't have access to this module" }
  }
  return { ok: true, user: authedUser }
}

// Route Handler guard for the employee self-service portal: requires an
// authenticated session with role='employee' whose employees row (matched
// via employees.portal_user_id, set once at provisioning — see
// app/api/employees/[id]/portal-access/route.ts) actually exists. Returns
// that employee's id so callers scope every query to it — this is what
// makes it impossible for one employee's login to fetch another's payslip,
// even by guessing a different staff number in the request: the id used
// for every query comes from THIS lookup, never from client input.
export async function requireEmployeeSelf(): Promise<
  { ok: true; employeeId: string } | { ok: false; status: number; error: string }
> {
  const authedUser = await getAuthedUserWithRole()
  if (!authedUser) {
    return { ok: false, status: 401, error: "Not authenticated" }
  }
  if (authedUser.role !== "employee") {
    return { ok: false, status: 403, error: "This area is only available to employee portal accounts" }
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return { ok: false, status: 503, error: "Backend is not configured" }
  }

  const { data: employee } = await admin
    .from("employees")
    .select("id")
    .eq("portal_user_id", authedUser.id)
    .single()

  if (!employee) {
    return { ok: false, status: 404, error: "No employee record is linked to this account" }
  }

  return { ok: true, employeeId: employee.id }
}

// Server Component / Route Handler client — reads the user's session from cookies.
// Next.js 16: `cookies()` is async, and Server Components cannot write cookies
// (middleware owns session refresh), so `setAll` is a best-effort no-op there.
export async function createSupabaseServerClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  const { cookies } = await import("next/headers")
  const cookieStore = await cookies()

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component — middleware handles session refresh instead.
        }
      },
    },
  })
}
