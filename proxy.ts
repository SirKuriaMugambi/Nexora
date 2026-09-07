import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up", "/access-ended", "/verify-code"]
// The two endpoints an unverified session needs to actually get verified —
// must stay reachable even while otp_verified is false, or nobody could
// ever complete the flow.
const OTP_API_PATHS = ["/api/signup-otp/request", "/api/signup-otp/verify"]

// Evaluation-access cutoff: from this instant on, only an exempted account
// may use the app — every other authenticated session gets redirected to
// /access-ended (or, for API calls, a 403). This is a deliberate, temporary
// business gate (closing an open-ended free evaluation), not a security
// fix — do not extend this pattern for real access control; the role
// checks in lib/supabase.ts remain the actual authorization boundary.
// Exemptions: the owner, Tony (finance manager — re-added after being
// caught by this same gate once it took effect), and every employee-portal
// account (role='employee') — a payslip/P9 self-service login is a
// different thing entirely from evaluating the full FinOps suite for free,
// so it's never meant to be swept up in this gate regardless of date.
const OWNER_EMAIL = "owner@example.com"
const EVAL_LOCK_EXEMPT_EMAILS = new Set([OWNER_EMAIL, "finance.manager@example.com"])
// 2026-09-03 00:00:00 Africa/Nairobi (EAT, UTC+3, no DST) == this UTC instant.
const RESTRICTED_ACCESS_FROM = new Date("2026-09-02T21:00:00Z")

// The only areas an employee-portal account (role='employee') may ever
// reach — everything else in the app redirects/403s them, not just hides
// the nav link for it. This is the real boundary, enforced the same way
// as every other access gate in this file: server-side, on every request.
const EMPLOYEE_PORTAL_PATH = "/my-portal"
function isAllowedForEmployeeRole(pathname: string): boolean {
  return pathname === EMPLOYEE_PORTAL_PATH || pathname.startsWith("/api/my/")
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return response
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublicPath = PUBLIC_PATHS.includes(pathname)

  // One profile fetch per authenticated request, reused by every gate below
  // instead of querying separately for each — otp_verified/role together.
  let role: string | null = null
  let otpVerified: boolean | null = null
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, otp_verified")
      .eq("id", user.id)
      .single()
    role = profile?.role ?? null
    otpVerified = profile?.otp_verified ?? null
  }

  const isEvalLockExempt =
    !user || EVAL_LOCK_EXEMPT_EMAILS.has(user.email ?? "") || role === "employee"
  const isLockedOut = !isEvalLockExempt && Date.now() >= RESTRICTED_ACCESS_FROM.getTime()

  if (isLockedOut) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "The evaluation period for this system has ended. Contact owner@example.com to continue." },
        { status: 403 },
      )
    }
    if (pathname !== "/access-ended") {
      return NextResponse.redirect(new URL("/access-ended", request.url))
    }
    return response
  }

  // Owner-approval gate for new sign-ups: an authenticated account that
  // hasn't been verified with the code the owner was emailed (or, for
  // employee-portal accounts, activated directly at provisioning — see
  // app/api/employees/[id]/portal-access) can reach NOTHING else until
  // it's verified. Only reachable exceptions: verify-code itself and the
  // two OTP endpoints.
  if (user && !OTP_API_PATHS.includes(pathname) && otpVerified === false) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "This account hasn't been verified yet. Enter the code the administrator gave you." },
        { status: 403 },
      )
    }
    if (pathname !== "/verify-code") {
      return NextResponse.redirect(new URL("/verify-code", request.url))
    }
    return response
  }

  // Employee self-service portal: role='employee' may reach ONLY its own
  // portal page and its own /api/my/* routes — never any other module,
  // never another employee's data, regardless of what nav links are shown.
  if (user && role === "employee" && !isAllowedForEmployeeRole(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not available to portal accounts" }, { status: 403 })
    }
    return NextResponse.redirect(new URL(EMPLOYEE_PORTAL_PATH, request.url))
  }

  if (!user && !isPublicPath) {
    const redirectUrl = new URL("/sign-in", request.url)
    return NextResponse.redirect(redirectUrl)
  }

  if (user && (pathname === "/sign-in" || pathname === "/sign-up")) {
    const redirectUrl = new URL(role === "employee" ? EMPLOYEE_PORTAL_PATH : "/dashboard", request.url)
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
