import { Resend } from "resend"

let client: Resend | null = null

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function sendPayslipEmail(params: {
  to: string
  employeeName: string
  monthLabel: string
  pdfBuffer: Buffer
  filename: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getClient()
  if (!resend) return { ok: false, error: "RESEND_API_KEY is not configured" }

  const from = process.env.PAYSLIP_FROM_EMAIL ?? "payroll@chrysal-africa.co.ke"

  const { error } = await resend.emails.send({
    from: `Chrysal Africa Payroll <${from}>`,
    to: params.to,
    subject: `Payslip — ${params.monthLabel}`,
    text: `Hi ${params.employeeName},\n\nYour payslip for ${params.monthLabel} is attached.\n\nThis is an automated message from Chrysal Africa's payroll system.`,
    attachments: [{ filename: params.filename, content: params.pdfBuffer }],
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Owner-approval gate for new sign-ups (see app/api/signup-otp/* and
// proxy.ts): the code goes ONLY to the system owner's own inbox, never to
// the person signing up — they must be handed it out-of-band.
export async function sendSignupOtpEmail(params: {
  ownerEmail: string
  newUserName: string
  newUserEmail: string
  code: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getClient()
  if (!resend) return { ok: false, error: "RESEND_API_KEY is not configured" }

  const from = process.env.PAYSLIP_FROM_EMAIL ?? "payroll@chrysal-africa.co.ke"

  const { error } = await resend.emails.send({
    from: `Chrysal FinOps <${from}>`,
    to: params.ownerEmail,
    subject: `New sign-up request — ${params.newUserName}`,
    text:
      `Someone just tried to create an account on Chrysal FinOps:\n\n` +
      `  Name:  ${params.newUserName}\n` +
      `  Email: ${params.newUserEmail}\n\n` +
      `Their verification code is: ${params.code}\n\n` +
      `This code expires in 15 minutes. Give it to them directly (call, WhatsApp, in person) ` +
      `only if you actually want them to have access — anyone with the code can activate that account.`,
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function sendP9Email(params: {
  to: string
  employeeName: string
  year: string
  pdfBuffer: Buffer
  filename: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getClient()
  if (!resend) return { ok: false, error: "RESEND_API_KEY is not configured" }

  const from = process.env.PAYSLIP_FROM_EMAIL ?? "payroll@chrysal-africa.co.ke"

  const { error } = await resend.emails.send({
    from: `Chrysal Africa Payroll <${from}>`,
    to: params.to,
    subject: `Tax Deduction Card (P9) — ${params.year}`,
    text: `Hi ${params.employeeName},\n\nYour P9 tax deduction card for ${params.year} is attached. You'll need this for your personal KRA tax return.\n\nThis is an automated message from Chrysal Africa's payroll system.`,
    attachments: [{ filename: params.filename, content: params.pdfBuffer }],
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
