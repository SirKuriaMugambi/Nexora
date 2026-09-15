import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { FilterChips } from "@/components/filter-chips"

const options = [
  { key: "matched" as const, label: "matched", count: 44 },
  { key: "unmatched" as const, label: "unmatched", count: 2 },
  { key: "skipped" as const, label: "rows skipped", count: 3 },
]

describe("FilterChips", () => {
  it("renders an All chip with the total, then one pressable chip per option with its count", () => {
    const html = renderToStaticMarkup(
      <FilterChips options={options} active={null} onChange={() => {}} total={49} allLabel="Rows read" />,
    )
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Rows read \(49\)<\/button>/)
    expect(html).toContain("44 × matched")
    expect(html).toContain("2 × unmatched")
    expect(html).toContain("3 × rows skipped")
    expect((html.match(/<button/g) ?? []).length).toBe(4)
  })

  it("marks only the active option as pressed", () => {
    const html = renderToStaticMarkup(
      <FilterChips options={options} active="unmatched" onChange={() => {}} total={49} />,
    )
    expect(html).toMatch(/aria-pressed="true"[^>]*>2 × unmatched/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>All \(49\)/)
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1)
  })
})
