import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up", "/access-ended", "/verify-code"]
// The two endpoints an unverified session needs to actually get verified —
// must stay reachable even while otp_verified is false, or nobody could
// ever complete the flow.
const OTP_API_PATHS = ["/api/signup-otp/request", "/api/signup-otp/verify"]

// Evaluation-access cutoff: from this instant on, only OWNER_EMAIL may use
// the app — every other authenticated session gets redirected to
// /access-ended (or, for API calls, a 403). This is a deliberate,
// temporary business gate (closing an open-ended free evaluation), not a
// security fix — do not extend this pattern for real access control; the
// role checks in lib/supabase.ts remain the actual authorization boundary.
const OWNER_EMAIL = "owner@example.com"
// 2026-09-03 00:00:00 Africa/Nairobi (EAT, UTC+3, no DST) == this UTC instant.
const RESTRICTED_ACCESS_FROM = new Date("2026-09-02T21:00:00Z")

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

  // Only ever blocks an AUTHENTICATED non-owner — an anonymous visitor still
  // sees the normal sign-in flow, and gets stopped here the instant their
  // session resolves to a non-owner account.
  const isLockedOut =
    Boolean(user) && user!.email !== OWNER_EMAIL && Date.now() >= RESTRICTED_ACCESS_FROM.getTime()

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
  // hasn't been verified with the code the owner was emailed can reach
  // NOTHING else — not the dashboard, not any API route — until it's
  // verified. Only reachable exceptions: the verify-code page itself and
  // the two OTP endpoints it calls.
  if (user && !OTP_API_PATHS.includes(pathname)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("otp_verified")
      .eq("id", user.id)
      .single()

    if (profile && profile.otp_verified === false) {
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
  }

  if (!user && !isPublicPath) {
    const redirectUrl = new URL("/sign-in", request.url)
    return NextResponse.redirect(redirectUrl)
  }

  if (user && (pathname === "/sign-in" || pathname === "/sign-up")) {
    const redirectUrl = new URL("/dashboard", request.url)
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
