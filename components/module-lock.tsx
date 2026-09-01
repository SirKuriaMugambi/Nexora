"use client"

import React, { useState, useSyncExternalStore } from "react"
import { KeyRound, Lock } from "lucide-react"

const STORAGE_KEY = "chrysal-module-unlock"
const CHANGE_EVENT = "chrysal-module-unlock-changed"

// sessionStorage exposed as an external store: the server snapshot is
// always "locked", and after a successful unlock we write the flag and
// dispatch CHANGE_EVENT so every mounted ModuleLock re-reads at once.
function subscribe(onStoreChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onStoreChange)
  return () => window.removeEventListener(CHANGE_EVENT, onStoreChange)
}
function getSnapshot(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "granted"
  } catch {
    return false
  }
}
function getServerSnapshot(): boolean {
  return false
}

/**
 * Second lock for the Payroll / Employee Master modules, layered on top of
 * the finance_manager role gate (which every API route still enforces —
 * that remains the real data boundary). This covers the unattended-machine
 * case: even with the finance manager's session signed in, opening these
 * modules asks for the module access code once per browser session.
 *
 * The code is verified server-side (/api/module-unlock) so it never ships
 * in the client bundle; sessionStorage keeps the unlocked state per tab and
 * clears when the browser closes, re-locking automatically.
 */
export default function ModuleLock({ moduleName, children }: { moduleName: string; children: React.ReactNode }) {
  const unlocked = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // Fallback for environments where sessionStorage writes throw (private
  // browsing etc.) — still unlock the current view after a verified code.
  const [unlockedLocally, setUnlockedLocally] = useState(false)

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    if (!password || checking) return
    setChecking(true)
    setError(null)
    try {
      const response = await fetch("/api/module-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? "Incorrect access code.")
      }
      try {
        sessionStorage.setItem(STORAGE_KEY, "granted")
      } catch {
        // Ignore — unlockedLocally below covers this tab regardless.
      }
      setUnlockedLocally(true)
      window.dispatchEvent(new Event(CHANGE_EVENT))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect access code.")
      setPassword("")
    } finally {
      setChecking(false)
    }
  }

  if (unlocked || unlockedLocally) return <>{children}</>

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <Lock className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
      <div className="space-y-1">
        <h1 className="text-sm font-bold font-mono uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
          {moduleName} — Restricted Module
        </h1>
        <p className="text-zinc-400 text-xs max-w-sm">
          This module contains salary and personal data. Enter the module access code to continue.
        </p>
      </div>

      <form onSubmit={handleUnlock} className="w-full max-w-[220px] space-y-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Access code"
          autoFocus
          className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-center font-mono text-xs tracking-[0.3em] focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded"
        />
        {error && <p className="text-[10px] font-mono text-rose-500">{error}</p>}
        <button
          type="submit"
          disabled={checking || !password}
          className="w-full py-1.5 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 rounded"
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>{checking ? "Verifying…" : "Unlock"}</span>
        </button>
      </form>
    </div>
  )
}
