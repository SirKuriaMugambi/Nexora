"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"

const DEPTH_KEY = "nexora_nav_depth"

/** How many in-app history entries this tab has made. Read only when clicked. */
function navDepth(): number {
  try {
    const depth = Number(sessionStorage.getItem(DEPTH_KEY) ?? "0")
    return Number.isFinite(depth) ? depth : 0
  } catch {
    return 0
  }
}

/**
 * Record an in-app history entry that did not change the path — a page
 * that pushes state of its own (the payroll tabs) must say so, or Back
 * would treat that entry as if it were not ours.
 */
export function noteInAppNavigation() {
  try {
    sessionStorage.setItem(DEPTH_KEY, String(navDepth() + 1))
  } catch {
    /* storage unavailable — the click falls back to the dashboard */
  }
}

/**
 * Step back to wherever you just were, anywhere in the app.
 *
 * Uses the browser's own history, so it returns to the previous place rather
 * than to a fixed parent: press Fix on a payroll warning, land on Employee
 * Master, press this, and you are back on the payroll tab you came from.
 *
 * On the very first page of a session there is nothing of ours behind, and
 * history.back() would step out of the app entirely — so that one case goes
 * to the dashboard instead. The depth counter only ever needs to answer
 * "have we navigated at all", which is why it is plain session storage read
 * at click time rather than React state: the button is always visible, so
 * nothing needs to re-render when it changes.
 */
export default function BackButton({ className = "" }: { className?: string }) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    noteInAppNavigation()
  }, [pathname])

  return (
    <button
      type="button"
      onClick={() => (navDepth() > 1 ? router.back() : router.push("/dashboard"))}
      title="Back to where you just were"
      aria-label="Go back to the previous page"
      className={`p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-900 transition-colors shrink-0 ${className}`}
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  )
}
