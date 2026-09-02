"use client"

import React, { useEffect, useState, useCallback } from "react"
import { KeyRound, Lock, RefreshCw } from "lucide-react"

interface PendingSignup {
  id: string
  email: string
  full_name: string | null
  role: string
  otp_code: string | null
  otp_expires_at: string | null
}

// Owner-only view of accounts awaiting sign-up verification, with the code
// shown directly — a fallback that works even without RESEND_API_KEY
// configured, since /api/signup-otp/request's email is the only other way
// this code ever leaves the database. The API route itself enforces the
// owner-only check (by email); a non-owner hitting this page just sees the
// 403 message below, same as any other restricted page in this app.
export default function PendingSignupsPage() {
  const [pending, setPending] = useState<PendingSignup[] | null>(null)
  // Captured once per load rather than read fresh during render — Date.now()
  // is an impure call and React's purity rule (correctly) flags it if it's
  // evaluated inline while rendering.
  const [loadedAt, setLoadedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Shared fetch logic used by both the initial load and the Refresh button.
  const fetchPending = useCallback(async (): Promise<{ pending: PendingSignup[] } | { error: string }> => {
    try {
      const response = await fetch("/api/admin/pending-signups")
      const payload = await response.json()
      if (!response.ok) {
        return { error: payload.error ?? "Failed to load pending sign-ups." }
      }
      return { pending: payload.pending }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load pending sign-ups." }
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchPending()
    if ("error" in result) {
      setError(result.error)
    } else {
      setPending(result.pending)
      setLoadedAt(Date.now())
    }
    setLoading(false)
  }, [fetchPending])

  // Effect-local loader, separate from `load` above, so the initial fetch
  // doesn't set state synchronously inside the effect body itself.
  useEffect(() => {
    let ignore = false
    fetchPending().then((result) => {
      if (ignore) return
      if ("error" in result) {
        setError(result.error)
      } else {
        setPending(result.pending)
        setLoadedAt(Date.now())
      }
      setLoading(false)
    })
    return () => { ignore = true }
  }, [fetchPending])

  if (error === "Not authorized") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
        <Lock className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
        <h1 className="text-sm font-bold font-mono uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Access Restricted</h1>
        <p className="text-zinc-400 text-xs max-w-sm">This page is only available to the system owner.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="pb-3 border-b border-zinc-200 dark:border-zinc-900 flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="text-base font-bold font-mono uppercase tracking-wider">Pending Sign-Ups</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-xs max-w-2xl">
            New accounts awaiting verification. Hand the code to the person directly — this list is only
            visible to you.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 rounded-lg shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" /><span>{loading ? "Loading…" : "Refresh"}</span>
        </button>
      </div>

      {error && error !== "Not authorized" && (
        <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">
          {error}
        </div>
      )}

      {pending && pending.length === 0 && (
        <p className="text-zinc-400 text-xs">No accounts are currently awaiting verification.</p>
      )}

      {pending && pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((p) => {
            const expired = p.otp_expires_at ? new Date(p.otp_expires_at).getTime() < loadedAt : true
            return (
              <div key={p.id} className="p-4 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 rounded-xl flex items-center justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <p className="font-mono text-xs font-bold truncate">{p.full_name ?? p.email}</p>
                  <p className="font-mono text-[10px] text-zinc-400 truncate">{p.email} · {p.role}</p>
                </div>
                <div className="text-right shrink-0">
                  {p.otp_code ? (
                    <>
                      <div className="flex items-center gap-1.5 justify-end font-mono text-lg font-bold tracking-[0.3em]">
                        <KeyRound className="h-4 w-4 text-zinc-400" />
                        <span className={expired ? "text-rose-500" : ""}>{p.otp_code}</span>
                      </div>
                      <p className={`text-[9px] font-mono uppercase ${expired ? "text-rose-500" : "text-zinc-400"}`}>
                        {expired ? "Expired — ask them to hit Resend" : `Expires ${new Date(p.otp_expires_at!).toLocaleTimeString("en-KE")}`}
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] font-mono text-zinc-400">No code requested yet</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
