"use client"

import React, { useCallback, useEffect, useState } from "react"
import { KeyRound, Eye, EyeOff, RefreshCw, ShieldCheck, Wand2 } from "lucide-react"
import type { StaffAccount } from "@/app/api/admin/staff-accounts/route"
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password-policy"

// Readable temporary passwords the owner can say out loud or type into a
// message: two words and four digits. Generated here in the browser; the
// server only ever receives what the owner submits.
const WORDS = ["Naivasha", "Nakuru", "Menengai", "Rongai", "Njoro", "Gilgil", "Molo", "Subukia", "Bahati", "Mau", "Elburgon", "Kuresoi"]
function suggestPassword(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)]
  const a = pick()
  let b = pick()
  while (b === a) b = pick()
  return `${a}-${b}-${Math.floor(1000 + Math.random() * 9000)}`
}

// Owner-only. Lists every staff account and lets the owner set a temporary
// password for one — the way to get someone in without emailing anything.
export function StaffAccountsPanel() {
  const [accounts, setAccounts] = useState<StaffAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<StaffAccount | null>(null)
  const [temp, setTemp] = useState("")
  const [show, setShow] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const fetchAccounts = useCallback(async (): Promise<{ error: string } | { accounts: StaffAccount[] }> => {
    try {
      const res = await fetch("/api/admin/staff-accounts")
      const json = (await res.json().catch(() => ({}))) as { error?: string; accounts?: StaffAccount[] }
      if (!res.ok) return { error: json.error ?? "Failed to load staff accounts." }
      return { accounts: json.accounts ?? [] }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load staff accounts." }
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const r = await fetchAccounts()
    if ("error" in r) setError(r.error); else setAccounts(r.accounts)
    setLoading(false)
  }, [fetchAccounts])

  useEffect(() => {
    let ignore = false
    fetchAccounts().then((r) => {
      if (ignore) return
      if ("error" in r) setError(r.error); else setAccounts(r.accounts)
      setLoading(false)
    })
    return () => { ignore = true }
  }, [fetchAccounts])

  const problem = temp ? validateNewPassword(temp) : null

  async function submit() {
    if (!target || saving || !temp || problem) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/staff-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.id, temporaryPassword: temp }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Could not set the password.")
      setDone(target.email)
      setTarget(null)
      setTemp("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the password.")
    } finally {
      setSaving(false)
    }
  }

  if (error === "Not authorized") return null

  return (
    <div className="space-y-3 pt-6 border-t border-zinc-200 dark:border-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold font-mono uppercase tracking-wider">Staff accounts</h2>
          <p className="text-zinc-500 dark:text-zinc-400 text-xs max-w-2xl">
            Set a temporary password for anyone who cannot get in. Tell them directly — nothing is emailed —
            and they will be asked to choose their own password the first time they sign in with it.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 rounded-lg shrink-0">
          <RefreshCw className="h-3.5 w-3.5" /><span>{loading ? "Loading…" : "Refresh"}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">{error}</div>
      )}
      {done && (
        <div className="flex items-start gap-2 p-3 border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 text-[11px]">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Temporary password set for <b className="font-mono">{done}</b>. Pass it on directly; they must change it at their next sign-in.</span>
        </div>
      )}

      {accounts && (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="p-4 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <p className="font-mono text-xs font-bold truncate">{a.full_name ?? a.email}</p>
                  <p className="font-mono text-[10px] text-zinc-400 truncate">
                    {a.email} · {a.role}
                    {!a.otp_verified && <span className="text-amber-500"> · not yet verified</span>}
                    {a.must_change_password && <span className="text-amber-500"> · temporary password, must change</span>}
                  </p>
                  <p className="font-mono text-[9px] text-zinc-400">
                    Last sign-in: {a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString("en-KE") : "never"}
                  </p>
                </div>
                <button
                  onClick={() => { setTarget(target?.id === a.id ? null : a); setTemp(""); setDone(null); setError(null) }}
                  className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-lg shrink-0"
                >
                  <KeyRound className="h-3.5 w-3.5" /><span>{target?.id === a.id ? "Cancel" : "Set temporary password"}</span>
                </button>
              </div>

              {target?.id === a.id && (
                <div className="border-t dark:border-zinc-900 pt-3 space-y-2">
                  <label className="text-[10px] font-mono text-zinc-400 uppercase block">Temporary password for {a.email}</label>
                  <div className="flex gap-2">
                    <input
                      type={show ? "text" : "password"}
                      value={temp}
                      onChange={(e) => setTemp(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submit() }}
                      autoFocus
                      autoComplete="off"
                      className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded-lg"
                    />
                    <button type="button" onClick={() => setTemp(suggestPassword())} title="Suggest one that is easy to say out loud"
                      className="px-2.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-lg"><Wand2 className="h-3.5 w-3.5 text-zinc-500" /></button>
                    <button type="button" onClick={() => setShow((v) => !v)} title={show ? "Hide" : "Show"}
                      className="px-2.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-lg">{show ? <EyeOff className="h-3.5 w-3.5 text-zinc-500" /> : <Eye className="h-3.5 w-3.5 text-zinc-500" />}</button>
                  </div>
                  <p className={`text-[10px] font-mono ${problem ? "text-amber-600" : "text-zinc-400"}`}>
                    {problem ?? `At least ${MIN_PASSWORD_LENGTH} characters with letters and numbers. They will replace it on first sign-in.`}
                  </p>
                  <button
                    onClick={submit}
                    disabled={saving || !temp || Boolean(problem)}
                    className="w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-lg disabled:opacity-50"
                  >
                    {saving ? "Setting…" : `Set temporary password for ${a.full_name ?? a.email}`}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
