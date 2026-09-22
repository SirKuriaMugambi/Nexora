import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import AppError from "@/app/error"
import NotFound from "@/app/not-found"
import WorkspaceLoading from "@/app/(workspace)/loading"

describe("failure and loading states render", () => {
  it("error page shows the reassurance, both actions, and the digest — never the raw message", () => {
    const err = Object.assign(new Error("relation \"employees\" does not exist: SELECT * FROM employees"), { digest: "abc123" })
    const html = renderToStaticMarkup(<AppError error={err} reset={() => {}} />)
    expect(html).toContain("Something went wrong")
    expect(html).toContain("Nothing you were working on has been saved")
    expect(html).toContain("Try again")
    expect(html).toContain("/dashboard")
    expect(html).toContain("abc123")
    // the exception text must not leak to the screen
    expect(html).not.toContain("SELECT")
    expect(html).not.toContain("employees")
  })

  it("error page renders without a digest", () => {
    const html = renderToStaticMarkup(<AppError error={new Error("boom")} reset={() => {}} />)
    expect(html).toContain("Something went wrong")
    expect(html).not.toContain("Reference")
    expect(html).not.toContain("boom")
  })

  it("404 renders and offers a way back", () => {
    const html = renderToStaticMarkup(<NotFound />)
    expect(html).toContain("Page not found")
    expect(html).toContain("There is nothing at this address")
    expect(html).toContain("/dashboard")
  })

  it("loading skeleton is announced to screen readers and draws placeholder rows", () => {
    const html = renderToStaticMarkup(<WorkspaceLoading />)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain("Loading…")
    expect(html).toContain("animate-pulse")
  })
})
