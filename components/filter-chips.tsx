"use client"

/**
 * A row of pressable count chips that filter a list by category — "All (50)
 * · 46 × no email · 4 × EMP code shared". One chip is active at a time;
 * pressing the active chip, or All, clears the filter.
 *
 * Shared by the payroll pre-flight panel, Employee Master and the
 * variable-pay import preview so the finance manager learns the gesture
 * once and it works the same everywhere.
 */

export type FilterChipTone = "amber" | "rose" | "emerald" | "neutral"

export interface FilterChipOption<K extends string> {
  key: K
  label: string
  count: number
}

const TONES: Record<FilterChipTone, { on: string; off: string }> = {
  amber: {
    on: "bg-amber-600 text-white border-amber-600 dark:bg-amber-500 dark:border-amber-500 dark:text-zinc-950",
    off: "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-900 dark:hover:bg-amber-900/70",
  },
  rose: {
    on: "bg-rose-600 text-white border-rose-600 dark:bg-rose-500 dark:border-rose-500 dark:text-zinc-950",
    off: "bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-900 dark:hover:bg-rose-900/70",
  },
  emerald: {
    on: "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500 dark:text-zinc-950",
    off: "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-900 dark:hover:bg-emerald-900/70",
  },
  neutral: {
    on: "bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100",
    off: "bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800 dark:hover:bg-zinc-800",
  },
}

export function FilterChips<K extends string>({
  options,
  active,
  onChange,
  total,
  tone = "neutral",
  allLabel = "All",
}: {
  options: FilterChipOption<K>[]
  active: K | null
  onChange: (next: K | null) => void
  /** Count shown on the All chip. */
  total: number
  tone?: FilterChipTone
  allLabel?: string
}) {
  const t = TONES[tone]
  const base = "font-mono text-[10px] px-2 py-0.5 border transition-colors select-none"
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by cause">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={active === null}
        className={`${base} ${active === null ? t.on : t.off}`}
      >
        {allLabel} ({total})
      </button>
      {options.map((opt) => {
        const isOn = active === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(isOn ? null : opt.key)}
            aria-pressed={isOn}
            title={isOn ? "Press again to show all" : `Show only: ${opt.label}`}
            className={`${base} ${isOn ? t.on : t.off}`}
          >
            {opt.count} × {opt.label}
          </button>
        )
      })}
    </div>
  )
}
