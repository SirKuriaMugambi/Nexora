"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import Logo from "@/components/logo"
import { ShieldCheck, AlertCircle, ArrowRight } from "lucide-react"

// Landing spot for any authenticated session whose profiles.otp_verified is
// still false (proxy.ts redirects here) — whether that's right after
// sign-up, or someone returning later having closed the tab before
// entering their code. The code itself was emailed only to the system
// owner; this page never displays or knows it, it just submits whatever
// the visitor was handed.
export default function VerifyCodePage() {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!code || verifying) return
    setVerifying(true)
    setError(null)
    setInfo(null)
    try {
      const response = await fetch("/api/signup-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? "Incorrect code.")
      }
      router.push("/dashboard")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code.")
      setCode("")
    } finally {
      setVerifying(false)
    }
  }

  async function handleResend() {
    if (resending) return
    setResending(true)
    setError(null)
    setInfo(null)
    try {
      const response = await fetch("/api/signup-otp/request", { method: "POST" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to send a new code.")
      }
      setInfo("A new code has been sent to the administrator.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send a new code.")
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl rounded-xl">
        <div className="text-center space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">Account Verification</p>
        </div>

        <p className="text-zinc-500 dark:text-zinc-400 text-[11px] leading-relaxed text-center">
          Your account has been created but isn&apos;t active yet. A verification code was sent to the
          system administrator — ask them for it directly to continue.
        </p>

        {error && (
          <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 px-3 py-2 text-[11px]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {info && (
          <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400 px-3 py-2 text-[11px]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{info}</span>
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-400 uppercase block">Verification Code</label>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoFocus
              className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-center font-mono text-sm tracking-[0.4em] focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={verifying || code.length !== 6}
            className="w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-lg disabled:opacity-50"
          >
            <span>{verifying ? "Verifying…" : "Verify & Continue"}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </form>

        <button
          onClick={handleResend}
          disabled={resending}
          className="w-full text-center text-[10px] font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50"
        >
          {resending ? "Sending…" : "Didn't get a code? Resend"}
        </button>
      </div>
    </div>
  )
}
