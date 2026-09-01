import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { requireRole } from "@/lib/supabase"

// Second lock on the Payroll / Employee Master modules, on top of (never
// instead of) the finance_manager role check: the role check is the real
// data boundary — every payroll/employees API route enforces it — while
// this gate covers the "signed-in machine left unattended" case at the UI
// level. Only the SHA-256 of the module password is stored here, and the
// comparison happens server-side so the password never ships in the client
// bundle. To change the password: node -e "console.log(require('crypto')
// .createHash('sha256').update('NEW').digest('hex'))" and replace the hash.
const MODULE_PASSWORD_SHA256 = "9a360f004badf7f9d42c997720ae949c44d9b37084ebe1992881d8c6125b064b"

export async function POST(request: Request) {
  const guard = await requireRole("finance_manager")
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const body = (await request.json().catch(() => ({}))) as { password?: string }
  if (typeof body.password !== "string" || body.password.length === 0) {
    return NextResponse.json({ error: "password is required" }, { status: 400 })
  }

  const hash = createHash("sha256").update(body.password).digest("hex")
  if (hash !== MODULE_PASSWORD_SHA256) {
    return NextResponse.json({ error: "Incorrect access code." }, { status: 403 })
  }

  return NextResponse.json({ ok: true })
}
