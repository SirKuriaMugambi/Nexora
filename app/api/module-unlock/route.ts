import { NextResponse } from "next/server"
import { createHash, timingSafeEqual } from "crypto"
import { requireRole } from "@/lib/supabase"
import { clearRateLimit, consumeRateLimit, retryAfterLabel } from "@/lib/rate-limit"

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

  // A 4-digit code is 10,000 guesses; a script would walk it in seconds.
  // Counted per signed-in account, since reaching here already required a
  // valid session.
  const limit = await consumeRateLimit("module-unlock", guard.user.id)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many incorrect codes. Try again ${retryAfterLabel(limit.retryAfter)}.` },
      { status: 429 },
    )
  }

  // Constant-time compare so response timing can't leak how much of the
  // code was right. Both sides are fixed-length hex digests, so the lengths
  // always match and timingSafeEqual cannot throw.
  const hash = createHash("sha256").update(body.password).digest("hex")
  const matches = timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(MODULE_PASSWORD_SHA256, "hex"))
  if (!matches) {
    return NextResponse.json({ error: "Incorrect access code." }, { status: 403 })
  }

  await clearRateLimit("module-unlock", guard.user.id)
  return NextResponse.json({ ok: true })
}
