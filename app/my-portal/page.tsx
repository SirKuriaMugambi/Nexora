"use client"

import React, { useEffect, useState, useCallback } from "react"
import { useFinOps } from "@/components/finops-provider"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import Logo from "@/components/logo"
import { Download, FileText, LogOut, Receipt } from "lucide-react"

const MONTH_LABELS: Record<string, string> = {
  "01": "January", "02": "February", "03": "March", "04": "April",
  "05": "May", "06": "June", "07": "July", "08": "August",
  "09": "September", "10": "October", "11": "November", "12": "December",
}
function formatMonth(month: string): string {
  const [year, m] = month.split("-")
  return `${MONTH_LABELS[m] ?? m} ${year}`
}

// Same download-blob approach as the rest of the app (see triggerDownload
// in app/(workspace)/payroll/page.tsx) — attach, click, detach, revoke on a
// delay, since revoking synchronously right after .click() cancels the
// download before the browser finishes reading it.
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// The employee self-service portal — the ONLY page a role='employee'
// account can reach (enforced server-side in proxy.ts, not just by this
// page existing). Every list and every download here is already scoped to
// the caller's own record by the API routes themselves (requireEmployeeSelf
// resolves employeeId from the session, never from anything this page
// sends) — this page has no way to ask for anyone else's data even if it
// tried to.
export default function MyPortalPage() {
  const { currentUser, signOut } = useFinOps()

  const [months, setMonths] = useState<string[] | null>(null)
  const [years, setYears] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const [monthsRes, yearsRes] = await Promise.all([
          fetch("/api/my/payslip-months"),
          fetch("/api/my/p9-years"),
        ])
        const monthsPayload = await monthsRes.json()
        const yearsPayload = await yearsRes.json()
        if (ignore) return
        if (monthsRes.ok) setMonths(monthsPayload.months)
        if (yearsRes.ok) setYears(yearsPayload.years)
        if (!monthsRes.ok || !yearsRes.ok) {
          setError(monthsPayload.error ?? yearsPayload.error ?? "Failed to load your records.")
        }
      } catch {
        if (!ignore) setError("Failed to load your records.")
      }
    }
    load()
    return () => { ignore = true }
  }, [])

  // No password, no "remember me" — access is a fresh emailed code every
  // time (see /employee-login). Signing out the moment they leave means the
  // next visit always needs a new code, rather than a session lingering
  // indefinitely on a shared or public device. Best-effort by nature (no
  // browser API guarantees a handler runs on close), same trade-off as the
  // visible Sign Out button already covers for a deliberate exit.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) return
    const handleLeave = () => { supabase.auth.signOut() }
    window.addEventListener("pagehide", handleLeave)
    return () => window.removeEventListener("pagehide", handleLeave)
  }, [])

  const handleDownloadPayslip = useCallback(async (month: string) => {
    if (busy) return
    setBusy(`payslip-${month}`)
    setError(null)
    try {
      const response = await fetch(`/api/my/payslips?month=${month}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? "Failed to download payslip.")
      }
      triggerDownload(await response.blob(), `payslip-${month}.pdf`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download payslip.")
    } finally {
      setBusy(null)
    }
  }, [busy])

  const handleDownloadP9 = useCallback(async (year: string) => {
    if (busy) return
    setBusy(`p9-${year}`)
    setError(null)
    try {
      const response = await fetch(`/api/my/p9?year=${year}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? "Failed to download P9.")
      }
      triggerDownload(await response.blob(), `P9-${year}.pdf`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download P9.")
    } finally {
      setBusy(null)
    }
  }, [busy])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black font-sans text-xs antialiased">
      <div className="max-w-lg mx-auto p-4 sm:p-8 space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-900">
          <div>
            <Logo />
            <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-1">My Portal{currentUser ? ` — ${currentUser}` : ""}</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <LogOut className="h-3.5 w-3.5" /><span>Sign Out</span>
          </button>
        </div>

        {error && (
          <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">
            {error}
          </div>
        )}

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-zinc-400" />
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider">My Payslips</h2>
          </div>
          {months === null ? (
            <p className="text-zinc-400 text-[11px]">Loading…</p>
          ) : months.length === 0 ? (
            <p className="text-zinc-400 text-[11px]">No payslips available yet.</p>
          ) : (
            <div className="border border-zinc-200 dark:border-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-900 rounded-xl overflow-hidden">
              {months.map((month) => (
                <div key={month} className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-zinc-950">
                  <span className="font-mono text-[11px]">{formatMonth(month)}</span>
                  <button
                    onClick={() => handleDownloadPayslip(month)}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{busy === `payslip-${month}` ? "Preparing…" : "Download"}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-zinc-400" />
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider">My P9 Tax Forms</h2>
          </div>
          {years === null ? (
            <p className="text-zinc-400 text-[11px]">Loading…</p>
          ) : years.length === 0 ? (
            <p className="text-zinc-400 text-[11px]">No P9 forms available yet.</p>
          ) : (
            <div className="border border-zinc-200 dark:border-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-900 rounded-xl overflow-hidden">
              {years.map((year) => (
                <div key={year} className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-zinc-950">
                  <span className="font-mono text-[11px]">{year}</span>
                  <button
                    onClick={() => handleDownloadP9(year)}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{busy === `p9-${year}` ? "Preparing…" : "Download"}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
