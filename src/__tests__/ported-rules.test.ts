// The 16 rules ported from the production registry in 0.3.0: entity gradient
// fills, the dataviz-honesty family, the layout-collapse family, and the
// base-polish tier. Each gets a detect + fix + (where cheap) opt-out check;
// the suite ends with an idempotency pass over a kitchen-sink fixture.

import { describe, expect, it } from "vitest"
import { applySlopFixes, runSlopGuard } from "../engine.js"
import { FLAGSHIP_RULES } from "../rules.js"

const guard = (html: string) => runSlopGuard(html, {}, FLAGSHIP_RULES)
const fix = (html: string) => applySlopFixes(html, {}, FLAGSHIP_RULES)

const page = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`

describe("entity gradient fills", () => {
  it("flattens a single-hue gradient tile to its saturated stop", () => {
    const html = page(
      `<div style="border-radius:12px;background:linear-gradient(135deg,#22c55e,#16a34a)">S</div>`,
    )
    expect(guard(html).counts.byRule["gradient-fill"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).toContain("background: #22c55e")
    expect(fixed).not.toContain("linear-gradient")
  })

  it("mutes a multi-hue gradient tile to the neutral surface", () => {
    const html = page(
      `<div style="border-radius:12px;background:linear-gradient(135deg,#f97316,#ec4899)">M</div>`,
    )
    expect(guard(html).counts.byRule["multicolor-fill"]).toBe(1)
    expect(fix(html).html).toContain("background: var(--surface, rgba(128,128,128,0.12))")
  })

  it("spares full-bleed gradients (no radius), photo scrims, and opt-outs", () => {
    const html = page(
      `<div style="background:linear-gradient(#f97316,#ec4899)">hero</div>` +
        `<div style="border-radius:8px;background:url(a.jpg), linear-gradient(#f97316,#ec4899)">photo</div>` +
        `<div style="--slop-allow: multicolor-fill; border-radius:8px;background:linear-gradient(#f97316,#ec4899)">ok</div>`,
    )
    const check = guard(html)
    expect(check.counts.byRule["gradient-fill"]).toBeUndefined()
    expect(check.counts.byRule["multicolor-fill"]).toBeUndefined()
  })

  it("collapses repeating-gradient stripes to their first color", () => {
    const html = page(
      `<div style="background:repeating-linear-gradient(45deg,#111 0 2px,transparent 2px 6px)">x</div>`,
    )
    expect(guard(html).counts.byRule["repeating-gradient-stripe"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain("repeating-linear-gradient")
    expect(fixed).toContain("background:#111")
  })
})

describe("dataviz honesty", () => {
  it("removes a fake dot cluster", () => {
    const html = page(
      `<span class="dot-row"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`,
    )
    expect(guard(html).counts.byRule["fake-dot-viz"]).toBe(1)
    expect(fix(html).html).not.toContain("dot-row")
  })

  it("strips short ungrouped ticks from a gauge svg", () => {
    const gauge =
      `<svg viewBox="0 0 100 60"><path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="#333"/>` +
      `<line x1="10" y1="10" x2="16" y2="12"/><line x1="30" y1="6" x2="34" y2="10"/><line x1="50" y1="4" x2="54" y2="8"/></svg>`
    const html = page(`<div class="score">${gauge}<span>7/10</span></div>`)
    expect(guard(html).counts.byRule["viz-stray-ticks"]).toBe(3)
    const fixed = fix(html).html
    expect(fixed).not.toContain("<line")
    expect(fixed).toContain("<path")
  })

  it("drops 0/N endpoint labels when the value already carries the scale", () => {
    const gauge =
      `<svg viewBox="0 0 100 60"><path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="#333"/>` +
      `<text x="5" y="58" font-size="8">0</text><text x="95" y="58" font-size="8">10</text></svg>`
    const html = page(`<div class="score">${gauge}<strong>7/10</strong></div>`)
    expect(guard(html).counts.byRule["viz-redundant-scale"]).toBe(2)
    const fixed = fix(html).html
    expect(fixed).not.toContain(">0</text>")
    expect(fixed).toContain("7/10")
  })

  it("removes a decorative emoji stacked on a metric", () => {
    const html = page(
      `<div class="progress-ring"><div class="figure">🏋️</div><span>74%</span></div>`,
    )
    expect(guard(html).counts.byRule["glyph-on-metric"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain("🏋")
    expect(fixed).toContain("74%")
  })

  it("strips the redundant leading icon off a stat category label", () => {
    const html = page(
      `<div class="tile"><div class="num">42</div><div class="cat"><svg class="ic"></svg>All</div></div>`,
    )
    expect(guard(html).counts.byRule["stat-label-icon"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain("<svg")
    expect(fixed).toContain("All")
  })

  it("leaves a nav row with a trailing count alone (icon is the affordance)", () => {
    const html = page(
      `<li class="row"><svg class="ic"></svg>Settings<span class="badge">3</span></li>`,
    )
    expect(guard(html).counts.byRule["stat-label-icon"]).toBeUndefined()
  })

  it("removes a LIVE clock eyebrow but spares plain times and LIVE STREAM copy", () => {
    const html = page(
      `<span class="eyebrow">● LIVE · 09:41</span><h2>LIVE STREAM setup</h2><span>Departs 09:41</span>`,
    )
    expect(guard(html).counts.byRule["live-clock-eyebrow"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain("eyebrow")
    expect(fixed).toContain("Departs 09:41")
    expect(fixed).toContain("LIVE STREAM setup")
  })
})

describe("layout collapse bugs", () => {
  it("removes a corner-pinned badge floated over the hero headline", () => {
    const html = page(
      `<section class="hero"><h1>Skin is a living archive</h1>` +
        `<div style="position:absolute;top:16px;right:16px;border-radius:12px;background:rgba(255,255,255,0.2)">Atelier Lab No 8</div></section>`,
    )
    expect(guard(html).counts.byRule["floating-hero-card"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain("Atelier Lab")
    expect(fixed).toContain("living archive")
  })

  it("relaxes fixed grid-auto-rows when a hairline divider would strand a void", () => {
    const html = page(
      `<div class="grid"><div class="cell">A</div><div class="sep"></div><div class="cell">B</div></div>`,
      `<style>.grid{display:grid;grid-auto-rows:168px}.sep{grid-column:1/-1;height:1px;background:#eee}</style>`,
    )
    expect(guard(html).counts.byRule["grid-spacer-void"]).toBe(1)
    expect(fix(html).html).toContain("grid-auto-rows: auto")
  })

  it("keeps the container inset when a co-applied class zeroes horizontal padding", () => {
    const html = page(
      `<section class="wrap band">content</section>`,
      `<style>.wrap{max-width:1100px;margin-inline:auto;padding-inline:24px}.band{padding:64px 0}</style>`,
    )
    expect(guard(html).counts.byRule["wrap-padding-collision"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).toContain("padding-block: 64px")
    expect(fixed).toContain("padding-inline:24px")
  })

  it("strips display:contents from body (inline and body{} rule)", () => {
    const html = `<!doctype html><html lang="en"><head><style>body{display:contents;margin:0}</style></head><body style="display:contents"><p>hi</p></body></html>`
    expect(guard(html).counts.byRule["body-display-contents"]).toBe(2)
    const fixed = fix(html).html
    expect(fixed).not.toMatch(/display\s*:\s*contents/i)
    expect(fixed).toContain("margin:0")
  })
})

describe("base polish tier", () => {
  it("never counts toward pass/severity, but injects on fix", () => {
    const html = page(`<h1>Title</h1><p>Body copy for the page.</p>`)
    const check = guard(html)
    expect(check.pass).toBe(true)
    expect(check.counts.byRule["text-wrap-orphans"]).toBeUndefined()
    expect(check.counts.byRule["font-smoothing"]).toBeUndefined()
    const fixed = fix(html).html
    expect(fixed).toContain('<style id="gesso-text-wrap">')
    expect(fixed).toContain('<style id="gesso-font-smoothing">')
    expect(fixed).toContain("text-wrap:balance")
    expect(fixed).toContain("-webkit-font-smoothing:antialiased")
  })

  it("mirrors a snap carousel's gutter into scroll-padding-inline", () => {
    const html = page(
      `<div class="carousel"><div class="card">1</div></div>`,
      `<style>.carousel{overflow-x:auto;scroll-snap-type:x mandatory;padding:0 16px}</style>`,
    )
    expect(guard(html).counts.byRule["hscroll-snap-gutter"]).toBeUndefined() // base: not a defect
    expect(fix(html).html).toContain("scroll-padding-inline:16px")
  })

  it("leaves bare fragments alone (no polish injection outside full documents)", () => {
    const fragment = `<div class="card"><p>snippet</p></div>`
    expect(fix(fragment).html).toBe(fragment)
  })
})

describe("ported-rule fixes are idempotent together", () => {
  const KITCHEN_SINK = page(
    `<div style="border-radius:12px;background:linear-gradient(135deg,#f97316,#ec4899)">M</div>` +
      `<span class="dot-row"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>` +
      `<div class="progress-ring"><div class="figure">🏋️</div><span>74%</span></div>` +
      `<span class="eyebrow">● LIVE · 09:41</span>` +
      `<section class="wrap band"><h1>A living archive of light</h1></section>`,
    `<style>.wrap{max-width:1100px;margin-inline:auto;padding-inline:24px}.band{padding:64px 0}` +
      `.carousel{overflow-x:auto;scroll-snap-type:x mandatory;padding:0 16px}</style>`,
  )

  it("second pass is a no-op", () => {
    const once = fix(KITCHEN_SINK).html
    const twice = fix(once)
    expect(twice.html).toBe(once)
    expect(twice.total).toBe(0)
  })
})
