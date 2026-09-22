import Link from "next/link"
import Logo from "@/components/logo"
import { Compass, LayoutDashboard } from "lucide-react"

/**
 * Shown for a URL that does not exist, instead of Next.js's default 404.
 * Kept deliberately vague about what does exist — this page is reachable
 * without signing in, so it must not confirm or deny any route.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl rounded-xl">
        <div className="text-center space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">Page not found</p>
        </div>

        <div className="flex items-start gap-2 text-zinc-500 dark:text-zinc-400 text-[11px] leading-relaxed">
          <Compass className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-400" />
          <span>There is nothing at this address. It may have been mistyped, or the link you followed is out of date.</span>
        </div>

        <Link
          href="/dashboard"
          className="w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-lg hover:opacity-90"
        >
          <LayoutDashboard className="h-3.5 w-3.5" /><span>Back to dashboard</span>
        </Link>
      </div>
    </div>
  )
}
