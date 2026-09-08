import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase-server"
import { requireRole } from "@/lib/supabase"

/**
 * One staff record: issue a short-lived link to open it, or retire it.
 *
 * GET returns a signed URL minted server-side after the role check rather
 * than letting the browser ask Storage for it directly. The bucket policy
 * would refuse a non-finance_manager anyway, but generating it here means a
 * link is only ever created for someone already proven to be allowed, and it
 * expires in a minute.
 */

async function loadStaffDocument(id: string) {
  const admin = createSupabaseAdminClient()
  if (!admin) return { admin: null, doc: null }
  const { data } = await admin
    .from("documents")
    .select("id, name, employee_id, storage_path, is_deleted")
    .eq("id", id)
    .not("employee_id", "is", null)
    .single()
  return { admin, doc: data }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { id } = await params
  const { admin, doc } = await loadStaffDocument(id)
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }
  if (!doc || doc.is_deleted) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 })
  }

  const { data, error } = await admin.storage
    .from("finops-documents")
    .createSignedUrl(doc.storage_path, 60)

  if (error || !data) {
    return NextResponse.json(
      { error: `Failed to open the file: ${error?.message ?? "unknown error"}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ url: data.signedUrl, name: doc.name })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (!reason) {
    return NextResponse.json({ error: "Give a reason for removing this document." }, { status: 400 })
  }

  const { admin, doc } = await loadStaffDocument(id)
  if (!admin) {
    return NextResponse.json({ error: "Backend is not configured" }, { status: 503 })
  }
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 })
  }

  // Soft delete only. An HR record that was filed and later withdrawn is
  // itself part of the employment history, so the row and the file both stay
  // — what changes is that it no longer appears in the list.
  const { error } = await admin
    .from("documents")
    .update({ is_deleted: true, deletion_reason: reason })
    .eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
