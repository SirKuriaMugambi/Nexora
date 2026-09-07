"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { useFinOps } from "@/components/finops-provider"
import { useTheme } from "@/components/theme-provider"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import Logo from "@/components/logo"
import Link from "next/link"
import { ShieldCheck, ArrowRight, AlertCircle } from "lucide-react"

// No password, no emailed code -- the credential is the same one employees
// already use every month to open their payslip PDF: the last 4 characters
// of their own KRA PIN (see app/api/portal-login). Supabase's magic-link
// token machinery is used only as the mechanism to issue a session once
// that check passes server-side -- nothing is ever emailed by this flow.
export default function EmployeeLoginPage() {
  const router = useRouter()
  const { applyAuthProfile, addAuditLog } = useFinOps()
  const { cardRadius, buttonRadius, accentBg, accentText } = useTheme()

  const [email, setEmail] = useState("")
  const [pin4, setPin4] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !pin4) return
    setError(null)
    setSubmitting(true)
    try {
      const response = await fetch("/api/portal-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin4 }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? "That email and KRA PIN combination doesn't match our records.")
      }

      const supabase = createSupabaseBrowserClient()
      if (!supabase) {
        throw new Error("Backend is not configured.")
      }

      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: payload.hashed_token,
        type: "magiclink",
      })
      if (verifyError || !data.user) {
        throw new Error(verifyError?.message ?? "Failed to sign you in.")
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role, email")
        .eq("id", data.user.id)
        .single()

      if (!profile) {
        throw new Error("Signed in, but no portal profile was found for this account.")
      }

      applyAuthProfile({ full_name: profile.full_name, role: profile.role, email: profile.email })
      addAuditLog(
        "USER SIGN-IN",
        "Supabase Auth",
        `Operator "${profile.full_name}" authenticated successfully. Session initiated.`,
      )

      router.push("/my-portal")
    } catch (err) {
      setError(err instanceof Error ? err.message : "That email and KRA PIN combination doesn't match our records.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className={`w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl ${cardRadius}`}>

        <div className="text-center space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">Employee Portal Sign-In</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 px-3 py-2 text-[11px]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">Your Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@chrysal-africa.co.ke"
              className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">Last 4 Characters of KRA PIN</label>
            <input
              type="text"
              value={pin4}
              onChange={(e) => setPin4(e.target.value)}
              placeholder="e.g. 123A"
              maxLength={4}
              className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 tracking-[0.3em] text-center uppercase focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              required
            />
            <p className="text-[9px] font-mono text-zinc-400">Same as what you already enter to open your payslip PDF.</p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className={`w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 ${accentBg} ${buttonRadius}`}
            >
              <span>{submitting ? "Verifying…" : "Access My Documents"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>

        <div className="border-t dark:border-zinc-900 pt-4 flex flex-col sm:flex-row items-center justify-between text-[10px] text-zinc-400 font-mono">
          <span>Not an employee? <Link href="/sign-in" className={`${accentText} hover:underline font-semibold`}>Operator Sign-In</Link></span>
          <div className="flex items-center gap-1 mt-1.5 sm:mt-0 text-[9px] text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>AES-256 SSL SECURED</span>
          </div>
        </div>
      </div>
    </div>
  )
}
