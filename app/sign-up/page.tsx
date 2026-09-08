"use client"

import React from "react"
import { useTheme } from "@/components/theme-provider"
import Logo from "@/components/logo"
import Link from "next/link"
import { ShieldCheck, Lock, ArrowLeft } from "lucide-react"

/**
 * Public sign-up is closed.
 *
 * It was open to anyone, and every new account was stamped with an operator
 * role before a human had approved it. That is now harmless on its own —
 * get_user_role() returns nothing until an account is verified, so an
 * unapproved account reads no data at all (see migration
 * 20260909100000_close_direct_api_read_access.sql) — but an open door that
 * creates accounts and emails approval codes to the owner has no business
 * being there for a company with two operators and staff who use the
 * employee portal instead.
 *
 * The page stays (rather than 404ing) so anyone following an old link gets
 * told what to do. Note this removes the UI only: the definitive switch is
 * "Allow new users to sign up" in the Supabase dashboard under
 * Authentication → Sign In / Providers → Email, which stops the API path too.
 * Turn that off as well.
 *
 * To add a genuine new operator: create the account from the Supabase
 * dashboard, then set its role in profiles and mark it verified.
 */
export default function SignUpClosedPage() {
  const { cardRadius, buttonRadius, accentText } = useTheme()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className={`w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl ${cardRadius}`}>
        <div className="text-center space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">Registration Closed</p>
        </div>

        <div className="flex flex-col items-center text-center space-y-3">
          <Lock className="h-7 w-7 text-zinc-300 dark:text-zinc-700" />
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Accounts for this system are created by the finance manager, not by self-registration.
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            If you are a Chrysal employee looking for your payslips or P9 forms, use the employee
            portal — you sign in with your work email and the last 4 characters of your KRA PIN.
          </p>
        </div>

        <div className="space-y-2">
          <Link
            href="/employee-login"
            className={`w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${buttonRadius}`}
          >
            <span>Employee Portal Sign-In</span>
          </Link>
          <Link
            href="/sign-in"
            className="w-full py-2 font-mono text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Operator Sign-In</span>
          </Link>
        </div>

        <div className="border-t dark:border-zinc-900 pt-4 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
          <span>
            Need access? <span className={accentText}>Contact the finance manager</span>
          </span>
          <div className="flex items-center gap-1 text-[9px] text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>SECURED</span>
          </div>
        </div>
      </div>
    </div>
  )
}
