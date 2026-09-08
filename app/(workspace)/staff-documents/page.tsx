"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFinOps } from "@/components/finops-provider"
import { useTheme } from "@/components/theme-provider"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import ModuleLock from "@/components/module-lock"
import { FolderLock, UploadCloud, Search, Eye, Trash2, ShieldAlert, Filter } from "lucide-react"

const STAFF_DOC_TYPES = [
  "Contract",
  "ID / Passport",
  "KRA PIN certificate",
  "Academic certificate",
  "Appraisal",
  "Disciplinary",
  "Leave record",
  "Medical",
  "Exit / clearance",
  "Other",
] as const

interface StaffDocument {
  id: string
  name: string
  staff_doc_type: string
  employee_id: string
  size: number
  uploaded_at: string
  uploaded_by: string
  storage_path: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
}

/** Groups documents by "Month Year", newest month first. */
function groupChronologically(docs: StaffDocument[]): Array<[string, StaffDocument[]]> {
  const groups = new Map<string, StaffDocument[]>()
  for (const doc of docs) {
    const d = new Date(doc.uploaded_at)
    const key = Number.isNaN(d.getTime())
      ? "Undated"
      : d.toLocaleDateString("en-KE", { month: "long", year: "numeric" })
    const bucket = groups.get(key)
    if (bucket) bucket.push(doc)
    else groups.set(key, [doc])
  }
  return [...groups.entries()]
}

function StaffDocumentsInner() {
  // Deliberately NOT useFinOps().employees — that list is seeded mock data
  // held in localStorage. The real 46 come from the employees API, the same
  // source the payroll page uses.
  const { currentUser, addAuditLog } = useFinOps()
  const { cardRadius, buttonRadius, accentBg } = useTheme()

  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([])
  const [docs, setDocs] = useState<StaffDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [employeeFilter, setEmployeeFilter] = useState("All")
  const [typeFilter, setTypeFilter] = useState("All")

  // Upload form
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadEmployee, setUploadEmployee] = useState("")
  const [uploadType, setUploadType] = useState<string>(STAFF_DOC_TYPES[0])
  const [displayName, setDisplayName] = useState("")
  const [uploading, setUploading] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteReason, setDeleteReason] = useState("")

  const employeeName = useCallback(
    (id: string) => employees.find((e) => e.id === id)?.name ?? id,
    [employees],
  )

  const fetchDocs = useCallback(async () => {
    const response = await fetch("/api/staff-documents")
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error ?? "Failed to load staff documents.")
    return (payload.documents ?? []) as StaffDocument[]
  }, [])

  useEffect(() => {
    let ignore = false
    fetchDocs()
      .then((d) => { if (!ignore) setDocs(d) })
      .catch((err) => { if (!ignore) { setDocs([]); setError(err.message) } })
    return () => { ignore = true }
  }, [fetchDocs])

  useEffect(() => {
    let ignore = false
    async function loadEmployees() {
      try {
        const response = await fetch("/api/employees")
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error ?? "Unable to load employees.")
        if (!ignore) setEmployees(payload.employees ?? [])
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Unable to load employees.")
      }
    }
    loadEmployees()
    return () => { ignore = true }
  }, [])

  const reload = useCallback(async () => {
    try {
      setDocs(await fetchDocs())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load staff documents.")
    }
  }, [fetchDocs])

  const filtered = useMemo(() => {
    if (!docs) return []
    const q = search.trim().toLowerCase()
    return docs.filter((d) => {
      if (employeeFilter !== "All" && d.employee_id !== employeeFilter) return false
      if (typeFilter !== "All" && d.staff_doc_type !== typeFilter) return false
      if (!q) return true
      return (
        d.name.toLowerCase().includes(q) ||
        d.employee_id.toLowerCase().includes(q) ||
        employeeName(d.employee_id).toLowerCase().includes(q)
      )
    })
  }, [docs, search, employeeFilter, typeFilter, employeeName])

  const grouped = useMemo(() => groupChronologically(filtered), [filtered])

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !uploadEmployee || uploading) return
    setUploading(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      if (!supabase) throw new Error("Backend is not configured.")

      // Uploaded straight to storage rather than through this app: a scanned
      // contract easily exceeds the request-body limit on the hosting plan.
      // The bucket's own policy restricts the staff/ prefix to
      // finance_manager, so this path is guarded server-side regardless.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      const storagePath = `staff/${uploadEmployee}/${Date.now()}-${safeName}`

      const { error: uploadError } = await supabase.storage
        .from("finops-documents")
        .upload(storagePath, file)
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const response = await fetch("/api/staff-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: uploadEmployee,
          storagePath,
          name: displayName.trim() || file.name,
          size: file.size,
          staffDocType: uploadType,
          uploadedBy: currentUser,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? "Failed to file the document.")

      addAuditLog(
        "STAFF DOCUMENT FILED",
        uploadEmployee,
        `Filed "${displayName.trim() || file.name}" (${uploadType}) against employee ${uploadEmployee}.`,
      )

      setFile(null)
      setDisplayName("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to file the document.")
    } finally {
      setUploading(false)
    }
  }

  async function handleOpen(doc: StaffDocument) {
    if (busyId) return
    setBusyId(doc.id)
    setError(null)
    try {
      const response = await fetch(`/api/staff-documents/${doc.id}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? "Failed to open the document.")
      window.open(payload.url, "_blank", "noopener,noreferrer")
      addAuditLog(
        "STAFF DOCUMENT OPENED",
        doc.employee_id,
        `Opened "${doc.name}" (${doc.staff_doc_type}) for employee ${doc.employee_id}.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open the document.")
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete(doc: StaffDocument) {
    if (!deleteReason.trim() || busyId) return
    setBusyId(doc.id)
    setError(null)
    try {
      const response = await fetch(`/api/staff-documents/${doc.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? "Failed to remove the document.")
      addAuditLog(
        "STAFF DOCUMENT REMOVED",
        doc.employee_id,
        `Removed "${doc.name}" for employee ${doc.employee_id}. Reason: ${deleteReason.trim()}`,
      )
      setDeleteId(null)
      setDeleteReason("")
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove the document.")
    } finally {
      setBusyId(null)
    }
  }

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.id.localeCompare(b.id)),
    [employees],
  )

  return (
    <div className="space-y-6">
      <div className="pb-3 border-b border-zinc-200 dark:border-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="text-base font-bold font-mono uppercase tracking-wider flex items-center gap-2">
            <FolderLock className="h-4 w-4 text-zinc-400" />
            Staff Documents
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-xs">
            Contracts, identity documents, certificates and HR correspondence, filed against each employee and
            listed newest first.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-amber-600 dark:text-amber-500 shrink-0">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>Finance Manager only</span>
        </div>
      </div>

      {error && (
        <div className="p-3 border border-rose-200 bg-rose-50/40 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900 text-[11px]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-[11px]">
        {/* Archive */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 px-2.5 py-1.5">
              <Search className="h-4 w-4 text-zinc-400 shrink-0" />
              <input
                type="text"
                placeholder="Search name or staff no…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent border-none text-[11px] focus:outline-none w-full"
              />
            </div>
            <div className="flex items-center gap-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 px-2.5 py-1.5 font-mono">
              <Filter className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <select
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                className="bg-transparent border-none w-full focus:outline-none text-[11px]"
              >
                <option value="All">All employees</option>
                {sortedEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.id} — {emp.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 px-2.5 py-1.5 font-mono">
              <Filter className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-transparent border-none w-full focus:outline-none text-[11px]"
              >
                <option value="All">All types</option>
                {STAFF_DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {docs === null ? (
            <p className="text-zinc-400 text-[11px] py-8 text-center">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className={`py-16 text-center border border-dashed border-zinc-200 dark:border-zinc-900 ${cardRadius}`}>
              <FolderLock className="h-7 w-7 text-zinc-300 dark:text-zinc-700 mx-auto" />
              <p className="text-zinc-400 text-[11px] mt-2">
                {docs.length === 0 ? "No staff documents filed yet." : "No documents match these filters."}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([month, monthDocs]) => (
                <div key={month} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[10px] font-mono uppercase tracking-wider font-bold text-zinc-400">{month}</h2>
                    <span className="text-[9px] font-mono text-zinc-300 dark:text-zinc-700">
                      {monthDocs.length} {monthDocs.length === 1 ? "document" : "documents"}
                    </span>
                  </div>
                  <div className={`border border-zinc-200 dark:border-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-900 overflow-hidden ${cardRadius}`}>
                    {monthDocs.map((doc) => (
                      <div key={doc.id} className="px-4 py-2.5 bg-white dark:bg-zinc-950 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">{doc.name}</p>
                            <p className="text-[9px] font-mono text-zinc-400">
                              {doc.employee_id} · {employeeName(doc.employee_id)} · {doc.staff_doc_type}
                            </p>
                            <p className="text-[9px] font-mono text-zinc-400">
                              Filed {formatWhen(doc.uploaded_at)} by {doc.uploaded_by} · {formatBytes(doc.size)}
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => handleOpen(doc)}
                              disabled={busyId !== null}
                              title="Open"
                              className={`p-1 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40 ${buttonRadius}`}
                            >
                              <Eye className="h-3.5 w-3.5 text-zinc-400" />
                            </button>
                            <button
                              onClick={() => { setDeleteId(doc.id); setDeleteReason("") }}
                              disabled={busyId !== null}
                              title="Remove"
                              className={`p-1 border border-rose-100 dark:border-rose-950/40 hover:bg-rose-50 dark:hover:bg-rose-950/20 disabled:opacity-40 ${buttonRadius}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                            </button>
                          </div>
                        </div>

                        {deleteId === doc.id && (
                          <div className="pt-2 border-t dark:border-zinc-900 space-y-1.5">
                            <input
                              type="text"
                              placeholder="Reason for removing this record…"
                              value={deleteReason}
                              onChange={(e) => setDeleteReason(e.target.value)}
                              className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[10px] font-mono focus:outline-none ${buttonRadius}`}
                            />
                            <div className="flex gap-1.5 justify-end">
                              <button
                                onClick={() => setDeleteId(null)}
                                className="px-2.5 py-1 border border-zinc-200 dark:border-zinc-800 text-zinc-500 text-[9px] font-mono uppercase"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => confirmDelete(doc)}
                                disabled={!deleteReason.trim() || busyId !== null}
                                className="px-2.5 py-1 bg-rose-600 disabled:opacity-50 text-white text-[9px] font-mono uppercase"
                              >
                                {busyId === doc.id ? "Removing…" : "Confirm"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* File a document */}
        <div className="space-y-4">
          <form
            onSubmit={handleUpload}
            className={`p-5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 space-y-4 ${cardRadius}`}
          >
            <h3 className="text-xs font-mono uppercase tracking-wider font-bold border-b border-zinc-150 dark:border-zinc-900 pb-2">
              File a Staff Document
            </h3>

            <div className="space-y-1">
              <label className="text-[10px] font-mono text-zinc-400 uppercase block">Employee</label>
              <select
                value={uploadEmployee}
                onChange={(e) => setUploadEmployee(e.target.value)}
                required
                className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              >
                <option value="">Select an employee…</option>
                {sortedEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.id} — {emp.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-mono text-zinc-400 uppercase block">Document Type</label>
              <select
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value)}
                className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              >
                {STAFF_DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-mono text-zinc-400 uppercase block">File</label>
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-mono text-zinc-400 uppercase block">Display Name (optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={file?.name || "e.g. Employment contract 2024"}
                className={`w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 ${buttonRadius}`}
              />
            </div>

            <button
              type="submit"
              disabled={!file || !uploadEmployee || uploading}
              className={`w-full py-2 font-mono text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 ${accentBg} ${buttonRadius}`}
            >
              <UploadCloud className="h-4 w-4" />
              <span>{uploading ? "Filing…" : "File Document"}</span>
            </button>
          </form>

          <div className={`p-4 border border-zinc-200 dark:border-zinc-900 bg-zinc-50/60 dark:bg-zinc-900/30 space-y-2 ${cardRadius}`}>
            <p className="text-[10px] font-mono uppercase text-zinc-400 font-bold">Who can see these</p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Only accounts with the Finance Manager role, and only after entering the module access code. The
              restriction is enforced on the files themselves as well as in this app, so no other role can reach
              them by any route. Every open, upload and removal is written to the audit trail.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StaffDocumentsPage() {
  return (
    <ModuleLock moduleName="Staff Documents">
      <StaffDocumentsInner />
    </ModuleLock>
  )
}
