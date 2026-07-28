// The member-facing docs promise users they know what the detector
// ACTUALLY entails. This suite is the ratchet: every rule in the registry
// must be documented (SKILL.md table, references/rules.md entry, README
// table) with the right category, severity, and tier, and no doc may claim
// a guard that does not exist. Add a rule, update all three; the numbers in
// "The N guards" headings update with it.

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { FLAGSHIP_RULES } from "../rules.js"

const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)

const skillMd = fs.readFileSync(
  path.join(PKG_ROOT, "skills/anti-slop/SKILL.md"),
  "utf8",
)
const rulesMd = fs.readFileSync(
  path.join(PKG_ROOT, "skills/anti-slop/references/rules.md"),
  "utf8",
)
const readmeMd = fs.readFileSync(path.join(PKG_ROOT, "README.md"), "utf8")

const registryIds = FLAGSHIP_RULES.map((r) => r.id).sort()

const TIER_LABEL: Record<string, string> = {
  fix: "FIX",
  gate: "GATE",
  base: "BASE",
  flag: "FLAG",
}

describe("docs stay in sync with the registry", () => {
  it("SKILL.md guard table matches the registry exactly", () => {
    const rows = [
      ...skillMd.matchAll(
        /^\| `([a-z-]+)` \| (\w+) \| (\d+) \| (FIX|GATE|BASE|FLAG) \|/gm,
      ),
    ]
    expect(rows.map((m) => m[1]).sort()).toEqual(registryIds)
    for (const [, id, category, severity, tier] of rows) {
      const rule = FLAGSHIP_RULES.find((r) => r.id === id)!
      expect(category, `${id} category`).toBe(rule.category)
      expect(Number(severity), `${id} severity`).toBe(rule.severity)
      expect(tier, `${id} tier`).toBe(TIER_LABEL[rule.tier])
    }
  })

  it("references/rules.md documents every guard with its severity and tier", () => {
    const heads = [
      ...rulesMd.matchAll(/^### ([a-z-]+) \(severity (\d+), (FIX|GATE|BASE|FLAG)\)$/gm),
    ]
    expect(heads.map((m) => m[1]).sort()).toEqual(registryIds)
    for (const [, id, severity, tier] of heads) {
      const rule = FLAGSHIP_RULES.find((r) => r.id === id)!
      expect(Number(severity), `${id} severity`).toBe(rule.severity)
      expect(tier, `${id} tier`).toBe(TIER_LABEL[rule.tier])
    }
    // Every entry carries the sections users rely on. BASE rules are
    // additive polish, not slop, so their rationale heading differs.
    for (const id of registryIds) {
      const rule = FLAGSHIP_RULES.find((r) => r.id === id)!
      const start = rulesMd.indexOf(`### ${id} `)
      const end = rulesMd.indexOf("### ", start + 1)
      const section = rulesMd.slice(start, end === -1 ? undefined : end)
      expect(section, `${id} detection spec`).toContain("**Detects:**")
      expect(section, `${id} rationale`).toContain(
        rule.tier === "base" ? "**Why it matters:**" : "**Why it reads as slop:**",
      )
    }
  })

  it("README table lists every guard with its tier", () => {
    const rows = [
      ...readmeMd.matchAll(/^\| `([a-z-]+)` \| (\w+) \| (FIX|GATE|BASE|FLAG) \|/gm),
    ]
    expect(rows.map((m) => m[1]).sort()).toEqual(registryIds)
    for (const [, id, , tier] of rows) {
      const rule = FLAGSHIP_RULES.find((r) => r.id === id)!
      expect(tier, `${id} tier`).toBe(TIER_LABEL[rule.tier])
    }
  })

  it("the claimed guard count matches the registry everywhere", () => {
    const n = FLAGSHIP_RULES.length
    for (const [name, text] of [
      ["SKILL.md", skillMd],
      ["README.md", readmeMd],
    ] as const) {
      const claims = [...text.matchAll(/[Tt]he (\d+) guards|(\d+) slop guards/g)]
        .map((m) => Number(m[1] ?? m[2]))
      expect(claims.length, `${name} claims a count`).toBeGreaterThan(0)
      for (const c of claims) expect(c, `${name} count`).toBe(n)
    }
  })

  it("every rule id referenced in the command exists", () => {
    const commandMd = fs.readFileSync(
      path.join(PKG_ROOT, "commands/critique.md"),
      "utf8",
    )
    for (const [, id] of commandMd.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) {
      if (id.startsWith("data-slop") || id.startsWith("slop-allow")) continue
      if (
        ["gesso-critique", "argument-hint", "anti-slop", "scroll-padding-inline"].includes(id)
      )
        continue
      expect(registryIds, `command references unknown guard ${id}`).toContain(id)
    }
  })
})
