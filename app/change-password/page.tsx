"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Logo from "@/components/logo"
import { KeyRound, AlertCircle, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react"
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password-policy"

// Where a signed-in staff member sets a new password. Reached voluntarily
// from the sidebar, or forced by proxy.ts (?required=1) after the owner has
// handed out a temporary password. The current password is always required
// — a temporary one counts — so a borrowed session alone cannot change it.
export default function ChangePasswordPage() {
  const router = useRouter()
  const [required] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("required") === "1")
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const policyProblem = next ? validateNewPassword(next, { notEqualTo: current }) : null
  const mismatch = confirm.length > 0 && confirm !== next

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !current || !next || policyProblem || mismatch) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? "Could not change the password.")
      setDone(true)
      setTimeout(() => { router.push("/dashboard"); router.refresh() }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.")
    } finally {
      setSaving(false)
    }
  }

  const field = "w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded-lg"

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl rounded-xl">
        <div className="text-center space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">
            {required ? "Set your password" : "Change password"}
          </p>
        </div>

        <p className="text-zinc-500 dark:text-zinc-400 text-[11px] leading-relaxed text-center">
          {required
            ? "You were given a temporary password. Choose your own to continue — nobody else will know it."
            : "Enter your current password, then the new one twice."}
        </p>

        {error && (
          <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 px-3 py-2 text-[11px]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}
        {done && (
          <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400 px-3 py-2 text-[11px]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>Password changed. Taking you in…</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">{required ? "Temporary password" : "Current password"}</label>
            <input type={show ? "text" : "password"} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus className={field} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">New password</label>
            <input type={show ? "text" : "password"} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
            <p className={`text-[10px] font-mono ${policyProblem ? "text-amber-600" : "text-zinc-400"}`}>
              {policyProblem ?? `At least ${MIN_PASSWORD_LENGTH} characters, with letters and numbers.`}
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">New password again</label>
            <input type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
            {mismatch && <p className="text-[10px] font-mono text-amber-600">The two entries do not match.</p>}
          </div>
          <button type="button" onClick={() => setShow((v) => !v)} className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 hover:text-zinc-600">
            {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}<span>{show ? "Hide" : "Show"} passwords</span>
          </button>
          <button
            type="submit"
            disabled={saving || done || !current || !next || Boolean(policyProblem) || mismatch || confirm.length === 0}
            className="w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-lg disabled:opacity-50"
          >
            <KeyRound className="h-3.5 w-3.5" /><span>{saving ? "Saving…" : "Set password"}</span><ArrowRight className="h-3.5 w-3.5" />
          </button>
        </form>

        {!required && (
          <Link href="/dashboard" className="block w-full text-center text-[10px] font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            Back without changing
          </Link>
        )}
      </div>
    </div>
  )
}
