import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"

/**
 * Confidential staff records — contracts, ID copies, certificates,
 * appraisals, disciplinary letters. finance_manager only, on every verb.
 *
 * The role check here is one of three layers, not the only one: the
 * documents table's RLS restricts staff-linked rows, and the storage bucket
 * policy restricts the files under `staff/` (see
 * supabase/migrations/20260908120000_add_staff_documents.sql). The storage
 * layer matters independently because the browser reaches Supabase Storage
 * directly, without passing through this app at all.
 */

/** The HR document types the UI offers. Anything else is rejected. */
export const STAFF_DOC_TYPES = [
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

export async function GET(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const params = new URL(request.url).searchParams
  const employeeId = params.get("employeeId")
  const docType = params.get("type")

  let query = admin
    .from("documents")
    .select("id, name, tag, staff_doc_type, employee_id, size, uploaded_at, uploaded_by, storage_path")
    .not("employee_id", "is", null)
    .eq("is_deleted", false)
    .order("uploaded_at", { ascending: false })

  if (employeeId) query = query.eq("employee_id", employeeId)
  if (docType) query = query.eq("staff_doc_type", docType)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ documents: data ?? [] })
}

export async function POST(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { employeeId, storagePath, name, size, staffDocType, uploadedBy } = body as Record<string, unknown>

  if (typeof employeeId !== "string" || !employeeId.trim()) {
    return NextResponse.json({ error: "Choose the employee this document belongs to." }, { status: 400 })
  }
  if (typeof storagePath !== "string" || !storagePath.startsWith(`staff/${employeeId}/`)) {
    // Guards against a caller recording a row that points at a file outside
    // this employee's folder — including a company document elsewhere in the
    // bucket, which would otherwise be readable through the staff list.
    return NextResponse.json({ error: "The stored file path does not match this employee." }, { status: 400 })
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "The document needs a name." }, { status: 400 })
  }
  if (typeof staffDocType !== "string" || !STAFF_DOC_TYPES.includes(staffDocType as typeof STAFF_DOC_TYPES[number])) {
    return NextResponse.json({ error: "Choose a valid document type." }, { status: 400 })
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    return NextResponse.json({ error: "Invalid file size." }, { status: 400 })
  }

  const { data: employee } = await admin
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .single()

  if (!employee) {
    return NextResponse.json({ error: `Employee "${employeeId}" not found.` }, { status: 404 })
  }

  const { data, error } = await admin
    .from("documents")
    .insert({
      name: name.trim(),
      tag: "staff record",
      staff_doc_type: staffDocType,
      employee_id: employeeId,
      storage_path: storagePath,
      size: Math.round(size),
      uploaded_by: typeof uploadedBy === "string" && uploadedBy.trim() ? uploadedBy.trim() : guard.user.id,
    })
    .select("id, name, tag, staff_doc_type, employee_id, size, uploaded_at, uploaded_by, storage_path")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ document: data }, { status: 201 })
}
