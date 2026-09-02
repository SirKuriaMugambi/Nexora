"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { useFinOps, UserRole } from "@/components/finops-provider"
import { useTheme } from "@/components/theme-provider"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import Logo from "@/components/logo"
import Link from "next/link"
import { ShieldCheck, ArrowRight, AlertCircle, MailCheck } from "lucide-react"

// Self-selected roles are never trusted — handle_new_user() (DB trigger) hardcodes
// every new sign-up to the lowest-privilege role server-side regardless of what's
// sent here. Elevating someone to finance_manager etc. is a manual, out-of-band
// action by the system owner after verifying identity. See migration
// 20260809090000_close_signup_privilege_escalation.sql for why.
const DEFAULT_SIGNUP_ROLE: UserRole = "production_manager"

export default function SignUpPage() {
  const router = useRouter()
  const { applyAuthProfile, addAuditLog } = useFinOps()
  const { cardRadius, buttonRadius, accentBg, accentText } = useTheme()

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const role = DEFAULT_SIGNUP_ROLE
  const [error, setError] = useState<string | null>(null)
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !email || !password) return
    setError(null)

    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError("Backend is not configured. Contact your system administrator.")
      return
    }

    setSubmitting(true)
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, role },
      },
    })
    setSubmitting(false)

    if (authError || !data.user) {
      setError(authError?.message || "Unable to create operator profile.")
      return
    }

    // Email confirmation is required before a session is issued — no profile row
    // exists to log against yet, so redirect to sign-in instead of the dashboard.
    if (!data.session) {
      setNeedsEmailConfirmation(true)
      return
    }

    applyAuthProfile({ full_name: name, role, email })

    addAuditLog(
      "USER SIGN-UP",
      "Supabase Auth",
      `Created new institutional profile for "${name}" with role "${role}". Session started.`,
    )

    // New accounts land locked (profiles.otp_verified defaults to false —
    // see the signup-otp migration) until the system owner hands over the
    // code emailed only to them. Fire that first email now rather than
    // waiting for the verify-code page's "resend" button; a failure here
    // isn't fatal, since that page can retry.
    try {
      await fetch("/api/signup-otp/request", { method: "POST" })
    } catch {
      // verify-code page's resend covers this
    }

    router.push("/verify-code")
  }

  if (needsEmailConfirmation) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
        <div className={`w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl text-center ${cardRadius}`}>
          <MailCheck className="h-8 w-8 mx-auto text-emerald-500" />
          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">Check your email</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
              We sent a confirmation link to <span className="font-semibold">{email}</span>. Confirm your address, then sign in.
            </p>
          </div>
          <Link
            href="/sign-in"
            className={`inline-flex w-full items-center justify-center gap-1.5 py-2 font-mono text-[10px] uppercase font-bold tracking-wider ${accentBg} ${buttonRadius}`}
          >
            <span>Go to Sign In</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className={`w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl ${cardRadius}`}>

        {/* Logo and header */}
        <div className="text-center space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">OPERATIONAL PROFILE REGISTRATION</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 px-3 py-2 text-[11px]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">Full Operator Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mercy Njoroge"
              className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              required
            />
          </div>

          <p className="text-[10px] text-zinc-400 leading-relaxed">
            New accounts start with standard access. Elevated permissions (e.g. Finance
            Manager) are granted manually by your administrator after verifying your identity.
          </p>

          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">Corporate Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@chrysal-africa.co.ke"
              className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">Secure Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              required
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className={`w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 ${accentBg} ${buttonRadius}`}
            >
              <span>{submitting ? "Onboarding…" : "Onboard Operator"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="border-t dark:border-zinc-900 pt-4 flex flex-col sm:flex-row items-center justify-between text-[10px] text-zinc-400 font-mono">
          <span>Already registered? <Link href="/sign-in" className={`${accentText} hover:underline font-semibold`}>Sign In</Link></span>
          <div className="flex items-center gap-1 mt-1.5 sm:mt-0 text-[9px] text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>AES-256 SSL SECURED</span>
          </div>
        </div>
      </div>
    </div>
  )
}
