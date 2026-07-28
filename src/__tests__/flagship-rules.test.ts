import { describe, expect, it } from "vitest"
import { applySlopFixes, runSlopGuard } from "../engine.js"
import { FLAGSHIP_RULES } from "../rules.js"

const guard = (html: string) => runSlopGuard(html, {}, FLAGSHIP_RULES)
const fix = (html: string) => applySlopFixes(html, {}, FLAGSHIP_RULES)

const SLOP_HTML = `<!doctype html>
<html>
<head>
<style>
.hero-title { background: linear-gradient(90deg, #ff00cc, #3333ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.card { background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
.cta { background: #6366f1; }
p.shout { text-transform: uppercase; }
</style>
</head>
<body>
<p style="text-align: justify">Body copy that is justified.</p>
<a style="text-decoration: underline">Link text</a>
<hr>
<h2>🚀 Launch week</h2>
<img src="">
<div class="metric">$28,461<span class="cents">.20</span></div>
<div>Revenue: $1,842,000 this year</div>
</body>
</html>`

describe("runSlopGuard on flagship rules", () => {
  it("detects the classic tells in a sloppy screen", () => {
    const check = guard(SLOP_HTML)
    expect(check.pass).toBe(false)
    const rules = Object.keys(check.counts.byRule)
    expect(rules).toContain("justified-text")
    expect(rules).toContain("underlined-text")
    expect(rules).toContain("gradient-text")
    expect(rules).toContain("indigo-accent")
    expect(rules).toContain("heavy-box-shadow")
    expect(rules).toContain("bare-hr")
    expect(rules).toContain("missing-lang")
    expect(rules).toContain("emoji-icon")
    expect(rules).toContain("broken-image")
    expect(rules).toContain("oversized-number")
    expect(check.severity).toBeGreaterThan(0)
  })

  it("passes clean HTML", () => {
    const clean = `<!doctype html><html lang="en"><body><p>Plain, honest copy.</p></body></html>`
    const check = guard(clean)
    expect(check.pass).toBe(true)
    expect(check.severity).toBe(0)
  })

  it("respects the --slop-allow opt-out for gradient text", () => {
    const html = `<html lang="en"><head><style>.t{ --slop-allow: gradient-text; background: linear-gradient(red, blue); background-clip: text; color: transparent; }</style></head><body></body></html>`
    expect(guard(html).counts.byRule["gradient-text"]).toBeUndefined()
  })

  it("sanctions gradient-text under replicate mode", () => {
    const html = `<html lang="en"><head><style>.t{ background: linear-gradient(red, blue); background-clip: text; color: transparent; }</style></head><body></body></html>`
    expect(guard(html).counts.byRule["gradient-text"]).toBe(1)
    const replicated = runSlopGuard(html, { replicate: true }, FLAGSHIP_RULES)
    expect(replicated.counts.byRule["gradient-text"]).toBeUndefined()
  })
})

describe("applySlopFixes on flagship rules", () => {
  it("rewrites the slop deterministically", () => {
    const { html: fixed, total } = fix(SLOP_HTML)
    expect(total).toBeGreaterThan(0)
    expect(fixed).toContain("text-align: left")
    expect(fixed).toContain("text-decoration:none")
    expect(fixed).not.toMatch(/background-clip:\s*text/i)
    expect(fixed).not.toContain("#6366f1")
    expect(fixed).toContain("var(--accent, currentColor)")
    expect(fixed).toContain('border-top:1px solid rgba(0,0,0,0.08)')
    expect(fixed).toContain("<html lang=\"en\">")
    expect(fixed).not.toContain("🚀")
    expect(fixed).not.toContain('<img src="">')
    // cents-suffix collapses the .20 span, then oversized-number abbreviates.
    expect(fixed).not.toContain('<span class="cents">.20</span>')
    expect(fixed).toContain("$28.5K")
    expect(fixed).toContain("$1.8M")
  })

  it("is idempotent", () => {
    const once = fix(SLOP_HTML).html
    const twice = fix(once)
    expect(twice.html).toBe(once)
    expect(twice.total).toBe(0)
  })

  it("leaves photo-pipeline image slots alone", () => {
    const html = `<html lang="en"><body><img data-photo-query="mountain sunrise"></body></html>`
    expect(fix(html).html).toContain("data-photo-query")
    expect(guard(html).counts.byRule["broken-image"]).toBeUndefined()
    expect(guard(html).counts.byRule["missing-alt"]).toBeUndefined()
  })
})

// Dash characters built from char codes: this test file stays dash-free,
// the same discipline em-dash-copy enforces.
const EM = String.fromCharCode(0x2014)
const EN = String.fromCharCode(0x2013)

describe("motion and copy guards", () => {
  it("flags transition:all but not named transitions", () => {
    const html = `<html lang="en"><head><style>.a{ transition: all .3s ease; } .b{ transition: transform 200ms ease-out, opacity 200ms ease-out; }</style></head><body><div style="transition-property: all"></div></body></html>`
    expect(guard(html).counts.byRule["transition-all"]).toBe(2)
    // gate tier: reported, never rewritten (base polish may inject elsewhere)
    expect(fix(html).html).toContain("transition: all .3s ease")
    expect(fix(html).html).toContain("transition-property: all")
  })

  it("respects --slop-allow for transition-all", () => {
    const html = `<html lang="en"><head><style>.a{ --slop-allow: transition-all; transition: all .3s; }</style></head><body></body></html>`
    expect(guard(html).counts.byRule["transition-all"]).toBeUndefined()
  })

  it("flags and fixes single em dashes and their entities in copy", () => {
    const html = `<html lang="en"><body><p>Design ${EM} refined.</p><p>Fast &mdash; simple.</p><p>Open ${EN} minded.</p></body></html>`
    expect(guard(html).counts.byRule["em-dash-copy"]).toBe(3)
    const fixed = fix(html).html
    expect(fixed).toContain("Design, refined.")
    expect(fixed).toContain("Fast, simple.")
    expect(fixed).toContain("Open, minded.")
  })

  it("spares en-dash ranges, dash runs, and dashes outside visible text", () => {
    const html = `<html lang="en"><head><style>/* a ${EM} comment */</style></head><body><p>Mon${EN}Fri, 9${EN}5</p><p>${EM}${EM}${EM}</p></body></html>`
    expect(guard(html).counts.byRule["em-dash-copy"]).toBeUndefined()
    // the run belongs to decorative-divider
    expect(guard(html).counts.byRule["decorative-divider"]).toBe(1)
  })

  it("flags lorem-ipsum filler (detect-only)", () => {
    const html = `<html lang="en"><body><p>Lorem ipsum dolor sit amet, consectetur.</p></body></html>`
    const check = guard(html)
    expect(check.counts.byRule["lorem-ipsum"]).toBe(2)
    // gate tier: the filler is reported, never rewritten
    expect(fix(html).html).toContain("Lorem ipsum dolor sit amet")
  })
})

describe("imagery guards", () => {
  it("adds empty alt to alt-less images and leaves broken ones to broken-image", () => {
    const html = `<html lang="en"><body><img src="https://images.unsplash.com/photo-1"><img src=""></body></html>`
    const check = guard(html)
    expect(check.counts.byRule["missing-alt"]).toBe(1)
    expect(check.counts.byRule["broken-image"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).toContain('<img src="https://images.unsplash.com/photo-1" alt="">')
    expect(fixed).not.toContain('<img src="">')
  })

  it("flags placeholder-service imagery (detect-only)", () => {
    const html = `<html lang="en"><body><img src="https://i.pravatar.cc/150?img=3" alt="avatar"><img src="https://picsum.photos/400/300" alt="cover"></body></html>`
    const check = guard(html)
    expect(check.counts.byRule["placeholder-image"]).toBe(2)
    // gate tier: the placeholder srcs are reported, never rewritten
    expect(fix(html).html).toContain("i.pravatar.cc")
    expect(fix(html).html).toContain("picsum.photos")
  })

  it("does not flag real photo CDNs as placeholders", () => {
    const html = `<html lang="en"><body><img src="https://images.unsplash.com/photo-1" alt="peaks"></body></html>`
    expect(guard(html).counts.byRule["placeholder-image"]).toBeUndefined()
  })
})

describe("data-slop-allow element opt-out", () => {
  it("spares an opted-out element and still flags its siblings", () => {
    const html = `<html lang="en"><body><h2 data-slop-allow="emoji-icon">🚀 Launch</h2><h2>🔥 Trending</h2><hr data-slop-allow="bare-hr"><img data-slop-allow="missing-alt broken-image" src=""></body></html>`
    const check = guard(html)
    expect(check.counts.byRule["emoji-icon"]).toBe(1)
    expect(check.counts.byRule["bare-hr"]).toBeUndefined()
    expect(check.counts.byRule["broken-image"]).toBeUndefined()
    expect(check.counts.byRule["missing-alt"]).toBeUndefined()
    const fixed = fix(html).html
    expect(fixed).toContain("🚀 Launch")
    expect(fixed).not.toContain("🔥")
  })
})
