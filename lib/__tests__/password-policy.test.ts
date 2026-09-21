import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password-policy"

describe("validateNewPassword", () => {
  it("accepts a password with enough length, letters and digits", () => {
    expect(validateNewPassword("Naivasha-Molo-4821")).toBeNull()
    expect(validateNewPassword("abcdefghi1")).toBeNull()
  })
  it("rejects short, letters-only, digits-only and single-character passwords", () => {
    expect(validateNewPassword("short1")).toMatch(new RegExp(String(MIN_PASSWORD_LENGTH)))
    expect(validateNewPassword("abcdefghijk")).toMatch(/letters and numbers/)
    expect(validateNewPassword("12345678901")).toMatch(/letters and numbers/)
    expect(validateNewPassword("aaaaaaaaaaaa")).toMatch(/letters and numbers/)
    expect(validateNewPassword("")).toBeTruthy()
  })
  it("refuses a new password equal to the current one", () => {
    expect(validateNewPassword("Naivasha-Molo-4821", { notEqualTo: "Naivasha-Molo-4821" })).toMatch(/different/)
    expect(validateNewPassword("Naivasha-Molo-4821", { notEqualTo: "something-else-99" })).toBeNull()
  })
})
