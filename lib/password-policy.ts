/**
 * One rule for every password the system accepts — the owner's temporary
 * ones and the ones staff choose for themselves — so nobody can set a
 * weaker password through one door than the other.
 */
export const MIN_PASSWORD_LENGTH = 10

/** Returns a message explaining what is wrong, or null when the password is acceptable. */
export function validateNewPassword(password: string, opts: { notEqualTo?: string } = {}): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Use both letters and numbers."
  }
  if (/^(.)\1+$/.test(password)) {
    return "That is one character repeated."
  }
  if (opts.notEqualTo !== undefined && password === opts.notEqualTo) {
    return "The new password must be different from the current one."
  }
  return null
}
