"use client"

import Link from "next/link"
import Logo from "@/components/logo"
import { ArrowRight, ShieldCheck } from "lucide-react"

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-black p-4 font-sans text-xs antialiased">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center">
          <Logo className="text-lg" />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Nexora
          </h1>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto leading-relaxed">
            Financial operations and compliance — payroll, statutory filing, reconciliation and reporting.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/sign-in"
            className="flex items-center justify-center gap-2 w-full py-2.5 font-mono text-[11px] uppercase font-bold tracking-wider bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          >
            <span>Initialize Session</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          
          <Link
            href="/sign-up"
            className="flex items-center justify-center gap-2 w-full py-2.5 font-mono text-[11px] uppercase font-bold tracking-wider border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <span>Onboard Operator</span>
          </Link>
        </div>

        <div className="flex items-center justify-center gap-1 text-[9px] text-emerald-600 dark:text-emerald-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>AES-256 SSL SECURED</span>
        </div>
      </div>
    </div>
  )
}
