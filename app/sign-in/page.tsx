"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { useFinOps } from "@/components/finops-provider"
import { useTheme } from "@/components/theme-provider"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import Logo from "@/components/logo"
import Link from "next/link"
import { ShieldCheck, ArrowRight, AlertCircle } from "lucide-react"

export default function SignInPage() {
  const router = useRouter()
  const { applyAuthProfile, addAuditLog } = useFinOps()
  const { cardRadius, buttonRadius, accentBg, accentText } = useTheme()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setError(null)

    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError("Backend is not configured. Contact your system administrator.")
      return
    }

    setSubmitting(true)
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !data.user) {
      setSubmitting(false)
      setError(authError?.message || "Invalid email or password.")
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, role, email")
      .eq("id", data.user.id)
      .single()

    setSubmitting(false)

    if (profileError || !profile) {
      setError("Signed in, but no operator profile was found for this account.")
      return
    }

    applyAuthProfile({
      full_name: profile.full_name,
      role: profile.role,
      email: profile.email,
    })

    addAuditLog(
      "USER SIGN-IN",
      "Supabase Auth",
      `Operator "${profile.full_name}" authenticated successfully. Session initiated.`,
    )

    router.push("/dashboard")
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className={`w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl ${cardRadius}`}>

        {/* Logo and header */}
        <div className="text-center space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">OPERATIONAL PORTAL SIGN-IN</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 px-3 py-2 text-[11px]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSignIn} className="space-y-4">
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
              <span>{submitting ? "Authenticating…" : "Initialize Session"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="border-t dark:border-zinc-900 pt-4 flex flex-col sm:flex-row items-center justify-between text-[10px] text-zinc-400 font-mono">
          {/* No sign-up link: registration is closed and accounts are created
              by the finance manager (see app/sign-up/page.tsx). */}
          <span>Accounts are issued by the finance manager</span>
          <div className="flex items-center gap-1 mt-1.5 sm:mt-0 text-[9px] text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>AES-256 SSL SECURED</span>
          </div>
        </div>

        <div className="text-center">
          <Link href="/employee-login" className={`text-[10px] font-mono ${accentText} hover:underline font-semibold`}>
            Employee? Access your payslips &amp; P9 forms →
          </Link>
        </div>
      </div>
    </div>
  )
}
