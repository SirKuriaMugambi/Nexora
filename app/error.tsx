"use client"

import { useEffect } from "react"
import Link from "next/link"
import Logo from "@/components/logo"
import { AlertTriangle, RotateCcw, LayoutDashboard } from "lucide-react"

/**
 * What anyone sees when a page throws, instead of Next.js's raw error screen.
 *
 * Deliberately uses no hooks beyond useEffect and no context: an error
 * boundary that depends on a provider would throw again if that provider is
 * what failed. Styling is plain Tailwind for the same reason — this must
 * render even when the theme has not loaded.
 *
 * The message the exception carries is NOT shown. It can contain a query, a
 * column name or a row's contents, and this screen is reachable by anyone
 * signed in; the digest is enough to find the real error in the logs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl rounded-xl">
        <div className="text-center space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">Something went wrong</p>
        </div>

        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 px-3 py-2 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            This screen could not be displayed. Nothing you were working on has been saved or changed — payroll
            figures are only written when you explicitly run or approve a payroll.
          </span>
        </div>

        <div className="space-y-2">
          <button
            onClick={reset}
            className="w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-lg hover:opacity-90"
          >
            <RotateCcw className="h-3.5 w-3.5" /><span>Try again</span>
          </button>
          <Link
            href="/dashboard"
            className="w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <LayoutDashboard className="h-3.5 w-3.5" /><span>Back to dashboard</span>
          </Link>
        </div>

        {error.digest && (
          <p className="text-center text-[10px] font-mono text-zinc-400">
            Reference <span className="text-zinc-600 dark:text-zinc-300">{error.digest}</span> — quote this if you report it.
          </p>
        )}
      </div>
    </div>
  )
}
