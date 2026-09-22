/**
 * Shown while a workspace page loads, in place of a blank content area.
 *
 * Renders inside the workspace layout, so the sidebar, header and the user's
 * theme stay put and only the content region changes — the page appears to
 * fill in rather than flash. The shape mirrors the common workspace layout
 * (title block → stat cards → table) so the skeleton settles into the real
 * content instead of jumping.
 */
const bar = "bg-zinc-200/70 dark:bg-zinc-800/70 rounded"

export default function WorkspaceLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* Title block */}
      <div className="pb-3 border-b border-zinc-200 dark:border-zinc-900 space-y-2">
        <div className={`h-4 w-56 ${bar}`} />
        <div className={`h-3 w-full max-w-xl ${bar}`} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="p-4 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 h-16 flex flex-col justify-between rounded-lg">
            <div className={`h-2 w-3/4 ${bar}`} />
            <div className={`h-3 w-1/2 ${bar}`} />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 overflow-hidden rounded-lg">
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-900">
          <div className={`h-3 w-48 ${bar}`} />
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-5 py-3 flex items-center gap-4">
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className={`h-3 w-40 max-w-full ${bar}`} />
                <div className={`h-2 w-24 max-w-full ${bar}`} />
              </div>
              <div className={`h-3 w-20 shrink-0 hidden sm:block ${bar}`} />
              <div className={`h-3 w-20 shrink-0 hidden md:block ${bar}`} />
              <div className={`h-3 w-24 shrink-0 ${bar}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
