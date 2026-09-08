import Logo from "@/components/logo"
import { Clock, Mail } from "lucide-react"

// Shown to anyone other than the system owner once RESTRICTED_ACCESS_FROM
// (proxy.ts) has passed — proxy.ts redirects here rather than letting the
// app render for a locked-out session. Deliberately static/server-rendered:
// no auth call needed to display it, so it works even if a session is
// already half-broken.
export default function AccessEndedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-6 sm:p-8 space-y-6 shadow-xl rounded-xl text-center">
        <div className="space-y-2">
          <Logo className="justify-center" />
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest pt-2">Operational Portal</p>
        </div>

        <div className="flex justify-center">
          <div className="h-10 w-10 rounded-full bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
            <Clock className="h-5 w-5 text-amber-500" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-sm font-bold font-mono uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
            Evaluation Period Ended
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-[11px] leading-relaxed">
            Thanks for trying out Nexora. The evaluation period has now closed.
            To continue using it, please get in touch to discuss next steps.
          </p>
        </div>

        <a
          href="mailto:owner@example.com?subject=Nexora%20%E2%80%94%20Continuing%20Access"
          className="inline-flex items-center justify-center gap-1.5 w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-lg hover:opacity-90"
        >
          <Mail className="h-3.5 w-3.5" />
          <span>Contact Caleb Mugambi</span>
        </a>
      </div>
    </div>
  )
}
