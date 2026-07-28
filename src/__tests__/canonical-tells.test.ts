// The 0.4.0 canonical-tell tranche (Gaps B + C of the coverage plan): the
// fingerprint colors beyond indigo, glow shadows, type-hygiene extremes,
// blob/ghost cards, template structures, motion tells, and the UI-microcopy
// pack. Positive detect + fix (where FIX) + one safety per rule, then an
// idempotency sweep.

import { describe, expect, it } from "vitest"
import { applySlopFixes, runSlopGuard } from "../engine.js"
import { FLAGSHIP_RULES } from "../rules.js"

const guard = (html: string) => runSlopGuard(html, {}, FLAGSHIP_RULES)
const fix = (html: string) => applySlopFixes(html, {}, FLAGSHIP_RULES)

const page = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`

describe("fingerprint colors", () => {
  it("routes the wider violet band to the accent token", () => {
    const html = page(`<button style="background:#a855f7">Go</button>`)
    expect(guard(html).counts.byRule["purple-violet-wash"]).toBe(1)
    expect(fix(html).html).toContain("var(--accent, currentColor)")
  })

  it("leaves the exact indigo hexes to indigo-accent and skips token definitions", () => {
    const html = page(
      `<div style="background:#6366f1">indigo</div>`,
      `<style>:root{--brand:#9333ea}</style>`,
    )
    expect(guard(html).counts.byRule["purple-violet-wash"]).toBeUndefined()
  })

  it("flags the emerald escape hatch without gating", () => {
    const check = guard(page(`<button style="background:#10b981">Start</button>`))
    expect(check.counts.byRule["safe-green-default"]).toBe(1)
    expect(check.pass).toBe(true)
  })

  it("strips a saturated glow shadow and neon text-shadow", () => {
    const html = page(
      `<div class="cta">Buy</div><h1 class="neon">Now</h1>`,
      `<style>.cta{box-shadow:0 0 40px rgba(6,182,212,0.25)}.neon{text-shadow:0 0 24px #22d3ee}</style>`,
    )
    expect(guard(html).counts.byRule["dark-glow"]).toBe(2)
    const fixed = fix(html).html
    expect(fixed).not.toContain("rgba(6,182,212")
    expect(fixed).not.toContain("#22d3ee")
  })

  it("keeps neutral elevation shadows", () => {
    const html = page(
      `<div>x</div>`,
      `<style>.card{box-shadow:0 1px 2px rgba(0,0,0,0.06)}</style>`,
    )
    expect(guard(html).counts.byRule["dark-glow"]).toBeUndefined()
  })

  it("flags the cream-and-serif costume only when both halves are present", () => {
    const creamy = page(
      `<h1>Quiet luxury</h1>`,
      `<style>body{background:#f4f1ea}h1{font-family:'Playfair Display', serif}</style>`,
    )
    expect(guard(creamy).counts.byRule["cream-default-wash"]).toBe(1)
    const white = page(
      `<h1>Quiet luxury</h1>`,
      `<style>body{background:#ffffff}h1{font-family:'Playfair Display', serif}</style>`,
    )
    expect(guard(white).counts.byRule["cream-default-wash"]).toBeUndefined()
  })
})

describe("type hygiene", () => {
  it("flags the four overused display faces, incl. via Google Fonts links", () => {
    const html = page(
      `<h1 style="font-family:'Space Grotesk',sans-serif">Hi</h1>` +
        `<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif" rel="stylesheet">`,
    )
    const hits = guard(html).counts.byRule["overused-font-stack"]
    expect(hits).toBe(2)
  })

  it("flags a page carried by a single family", () => {
    const mono = page(
      `<h1>One voice</h1>`,
      `<style>h1{font-family:'Inter',sans-serif}p{font-family:'Inter',sans-serif}</style>`,
    )
    expect(guard(mono).counts.byRule["single-font-page"]).toBe(1)
    const paired = page(
      `<h1>Two voices</h1>`,
      `<style>h1{font-family:'Fraunces',serif}p{font-family:'Inter',sans-serif}</style>`,
    )
    expect(guard(paired).counts.byRule["single-font-page"]).toBeUndefined()
  })

  it("relaxes crushed display tracking", () => {
    const html = page(`<h1 style="letter-spacing:-0.06em">Tight</h1>`)
    expect(guard(html).counts.byRule["crushed-tracking"]).toBe(1)
    expect(fix(html).html).toContain("letter-spacing:-0.02em")
  })

  it("reins in wide tracking on mixed-case text but spares tracked caps", () => {
    const html = page(
      `<p style="letter-spacing:0.12em">Long airy paragraph text</p>` +
        `<span style="letter-spacing:0.12em;text-transform:uppercase">Label</span>`,
    )
    expect(guard(html).counts.byRule["wide-body-tracking"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).toContain("letter-spacing:0.01em")
    expect(fixed).toContain('letter-spacing:0.12em;text-transform:uppercase')
  })

  it("opens up shingled body leading, sparing display sizes", () => {
    const html = page(
      `<p style="font-size:15px;line-height:1.1">body copy</p>` +
        `<h1 style="font-size:56px;line-height:1.05">Display</h1>`,
    )
    expect(guard(html).counts.byRule["tight-line-height"]).toBe(1)
    expect(fix(html).html).toContain("line-height:1.4")
  })

  it("raises sub-11px text, sparing uppercase micro-labels", () => {
    const html = page(
      `<p style="font-size:9px">fine print nobody can read</p>` +
        `<span style="font-size:10px;text-transform:uppercase">Nano</span>`,
    )
    expect(guard(html).counts.byRule["tiny-body-text"]).toBe(1)
    expect(fix(html).html).toContain("font-size:12px")
  })

  it("flags monospace prose", () => {
    const html = page(
      `<p>terminal cosplay</p>`,
      `<style>p{font-family:'JetBrains Mono',monospace}</style>`,
    )
    expect(guard(html).counts.byRule["monospace-body"]).toBe(1)
  })
})

describe("blob, ghost, and template structures", () => {
  it("clamps blob-card radii, sparing pills and circles", () => {
    const html = page(
      `<div style="background:#fff;border-radius:48px">card</div>` +
        `<button style="background:#fff;border-radius:999px">pill</button>` +
        `<span style="background:#fff;border-radius:50%">o</span>`,
    )
    expect(guard(html).counts.byRule["over-rounded-card"]).toBe(1)
    expect(fix(html).html).toContain("border-radius:24px")
  })

  it("drops the ghost card's halo, keeping its hairline", () => {
    const html = page(
      `<div style="border:1px solid rgba(0,0,0,0.08); box-shadow:0 24px 48px rgba(0,0,0,0.08)">ghost</div>`,
    )
    expect(guard(html).counts.byRule["ghost-card"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).toContain("border:1px solid rgba(0,0,0,0.08)")
    expect(fixed).not.toContain("box-shadow")
  })

  it("gates cards nested in cards, sparing chips", () => {
    const html = page(
      `<div style="background:#fff;border-radius:12px">` +
        `<div style="background:#f3f3f3;border-radius:8px"><h3>Inner</h3><p>A whole card inside a card.</p></div>` +
        `<span style="background:#eee;border-radius:8px">chip</span>` +
        `</div>`,
    )
    expect(guard(html).counts.byRule["nested-cards"]).toBe(1)
  })

  it("flags leading-zero section scaffolding only in sequence", () => {
    const seq = page(`<span>01</span><h2>Plan</h2><span>02</span><h2>Build</h2>`)
    expect(guard(seq).counts.byRule["numbered-section-markers"]).toBe(2)
    const lone = page(`<span>01</span><h2>Plan</h2>`)
    expect(guard(lone).counts.byRule["numbered-section-markers"]).toBeUndefined()
  })

  it("flags the icon-heading-blurb card template at x3", () => {
    const card = `<div class="feat"><svg viewBox="0 0 24 24"></svg><h3>Fast</h3><p>Very quick indeed.</p></div>`
    const html = page(`<section>${card}${card}${card}</section>`)
    expect(guard(html).counts.byRule["icon-topped-feature-card"]).toBe(1)
  })
})

describe("motion tells", () => {
  it("lands overshoot easings on ease-out", () => {
    const html = page(
      `<div>m</div>`,
      `<style>.modal{transition:transform .3s cubic-bezier(.34,1.56,.64,1)}.ok{transition:opacity .2s cubic-bezier(.4,0,.2,1)}</style>`,
    )
    expect(guard(html).counts.byRule["bounce-easing"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).toContain("transition:transform .3s ease-out")
    expect(fixed).toContain("cubic-bezier(.4,0,.2,1)")
  })

  it("gates layout-property transitions, leaving transform/opacity alone", () => {
    const html = page(
      `<div>p</div>`,
      `<style>.panel{transition:height .3s ease}.fine{transition:transform .2s ease, opacity .2s ease}</style>`,
    )
    expect(guard(html).counts.byRule["layout-prop-animation"]).toBe(1)
  })

  it("flags the reflex hover zoom on imagery", () => {
    const html = page(
      `<div>i</div>`,
      `<style>.card img:hover{transform:scale(1.05)}.btn:hover{transform:translateY(-1px)}</style>`,
    )
    expect(guard(html).counts.byRule["hover-scale-image"]).toBe(1)
  })
})

describe("UI microcopy", () => {
  it("gates benefit-speak but keeps functional 'unlock'", () => {
    const html = page(
      `<h2>Effortlessly streamline your workflow</h2><button>Unlock with Face ID</button>`,
    )
    const check = guard(html)
    expect(check.counts.byRule["benefit-speak"]).toBe(2)
    expect(check.pass).toBe(false) // gate: needs real copy
  })

  it("flags the not-X-but-Y cadence", () => {
    const html = page(`<p>It's not just a to-do list, it's your second brain.</p>`)
    expect(guard(html).counts.byRule["not-x-but-y-cadence"]).toBe(1)
  })

  it("flags invented precision stats", () => {
    const html = page(`<div>99.9% uptime and 10x faster, the #1 platform.</div>`)
    expect(guard(html).counts.byRule["fabricated-precision"]).toBe(3)
  })

  it("gates apologetic error copy", () => {
    const html = page(`<p>Oops! Something went wrong.</p>`)
    expect(guard(html).counts.byRule["apologetic-error-copy"]).toBeGreaterThanOrEqual(1)
  })

  it("never reads copy tells out of <style> or <script>", () => {
    const html = page(
      `<p>All good here.</p>`,
      `<style>/* effortlessly seamless 99.9% */</style><script>const s = "Oops! Something went wrong";</script>`,
    )
    const check = guard(html)
    expect(check.counts.byRule["benefit-speak"]).toBeUndefined()
    expect(check.counts.byRule["fabricated-precision"]).toBeUndefined()
    expect(check.counts.byRule["apologetic-error-copy"]).toBeUndefined()
  })
})

describe("canonical-tell idempotency", () => {
  it("fixing twice is a no-op across the new fixers", () => {
    const html = page(
      `<button style="background:#a855f7">Go</button>` +
        `<h1 style="letter-spacing:-0.08em">Tight headline here.</h1>` +
        `<p style="font-size:15px;line-height:1.05;letter-spacing:0.1em">crowded airy body</p>` +
        `<div style="background:#fff;border-radius:64px">blob</div>` +
        `<div style="border:1px solid rgba(0,0,0,0.06); box-shadow:0 32px 64px rgba(0,0,0,0.1)">ghost</div>`,
      `<style>.cta{box-shadow:0 0 32px rgba(168,85,247,0.28)}.m{transition:transform .3s cubic-bezier(.3,1.4,.6,1)}</style>`,
    )
    const once = fix(html).html
    expect(fix(once).html).toBe(once)
  })
})
