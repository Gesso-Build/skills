// Comparative readings of checked documents need more than the gating
// severity: advisory (flag-tier) hits and style-input completeness are
// context the check must carry, and advisory hits must never gate the
// verdict. These tests pin that report-context contract.
import { describe, expect, it } from "vitest"

import { runSlopGuard } from "../engine.js"
import type { SlopCtx, SlopRule } from "../types.js"

function rule(
  id: string,
  tier: "fix" | "gate" | "flag",
  hits: number,
): SlopRule<SlopCtx> {
  return {
    id,
    category: "copy",
    tell: `${id} (test rule)`,
    prevention: "n/a (test rule)",
    tier,
    severity: 1,
    detect: () =>
      Array.from({ length: hits }, (_, i) => ({ ruleId: id, detail: `hit ${i}` })),
    ...(tier === "fix" ? { fix: (html: string) => html } : {}),
  }
}

describe("gating vs advisory counts", () => {
  it("splits the totals and keeps advisory out of pass and severity", () => {
    const check = runSlopGuard("<html></html>", {}, [
      rule("gate-a", "gate", 2),
      rule("flag-b", "flag", 5),
    ])
    expect(check.counts.gating).toBe(2)
    expect(check.counts.advisory).toBe(5)
    expect(check.counts.total).toBe(7)
    expect(check.pass).toBe(false)
    expect(check.severity).toBe(2)
  })

  it("passes with zero severity on advisory-only hits", () => {
    const check = runSlopGuard("<html></html>", {}, [rule("flag-only", "flag", 3)])
    expect(check.pass).toBe(true)
    expect(check.severity).toBe(0)
    expect(check.counts.gating).toBe(0)
    expect(check.counts.advisory).toBe(3)
    expect(check.counts.total).toBe(3)
  })
})

describe("external stylesheet completeness signal", () => {
  const NO_RULES: SlopRule<SlopCtx>[] = []

  it("counts linked stylesheets the document does not inline", () => {
    const check = runSlopGuard(
      '<link rel="stylesheet" href="https://cdn.example.com/site.css">' +
        '<link href="/styles/app.css" rel="stylesheet">',
      {},
      NO_RULES,
    )
    expect(check.externalStylesheets).toBe(2)
  })

  it("ignores font-service links, which only deliver @font-face", () => {
    const check = runSlopGuard(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces">' +
        '<link rel="stylesheet" href="https://fonts.bunny.net/css?family=x">',
      {},
      NO_RULES,
    )
    expect(check.externalStylesheets).toBe(0)
  })

  it("counts @import targets inside style blocks", () => {
    const check = runSlopGuard(
      "<style>@import url('https://cdn.example.com/theme.css'); body { color: red }</style>",
      {},
      NO_RULES,
    )
    expect(check.externalStylesheets).toBe(1)
  })

  it("reports zero for a self-contained document", () => {
    const check = runSlopGuard(
      '<style>body { margin: 0 }</style><link rel="icon" href="/favicon.ico">',
      {},
      NO_RULES,
    )
    expect(check.externalStylesheets).toBe(0)
  })
})
