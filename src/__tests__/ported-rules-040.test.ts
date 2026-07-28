// The 14 rules ported from the production registry in 0.4.0: print-chrome
// copy artifacts (mastheads), the hero kicker eyebrow, redundant chrome
// (edge stripes, borders on fills), headline consistency, the advisory
// list-row family, the reveal-specificity layout bug, will-change hygiene,
// and the image-outline base polish. Each gets a detect + fix (or advisory)
// + a safety check; the suite ends with engine advisory semantics and an
// idempotency pass.

import { describe, expect, it } from "vitest"
import { applySlopFixes, runSlopGuard } from "../engine.js"
import { FLAGSHIP_RULES } from "../rules.js"

const guard = (html: string, ctx: Record<string, unknown> = {}) =>
  runSlopGuard(html, ctx, FLAGSHIP_RULES)
const fix = (html: string) => applySlopFixes(html, {}, FLAGSHIP_RULES)

const page = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`

describe("print-chrome copy artifacts", () => {
  it("removes a fake publication-metadata cluster whole", () => {
    const html = page(
      `<div class="hero-meta"><span>VOL. 04 / 2024</span><span>Catalogue HV-IDX-029</span></div><h2>Real content</h2>`,
    )
    expect(guard(html).counts.byRule["publication-masthead-block"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain("HV-IDX-029")
    expect(fixed).toContain("Real content")
  })

  it("spares footer bars and serial-only spec tables", () => {
    const html = page(
      `<footer><div>VOL. 1 · HV-IDX-029</div></footer>` +
        `<div class="specs">SKU AB-CD-123 · warehouse row 4</div>`,
    )
    expect(guard(html).counts.byRule["publication-masthead-block"]).toBeUndefined()
  })

  it("removes a lone VOL./№ eyebrow but not undotted answers or headings", () => {
    const html = page(
      `<div><h2>Archive</h2><span class="eyebrow">VOL. 04 · № 27</span></div>` +
        `<span>NO 1</span><h3>VOL. 9</h3>`,
    )
    expect(guard(html).counts.byRule["masthead-eyebrow"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain("№ 27")
    expect(fixed).toContain("NO 1")
    expect(fixed).toContain("VOL. 9")
  })
})

describe("hero kicker eyebrow", () => {
  it("removes the uppercase kicker directly above a prose H1", () => {
    const html = page(
      `<section><p style="text-transform:uppercase;letter-spacing:0.12em">Maison Noir · Atelier</p><h1>Skin is a living archive of light.</h1></section>`,
    )
    expect(guard(html).counts.byRule["hero-kicker-eyebrow"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain("Maison Noir")
    expect(fixed).toContain("living archive")
  })

  it("removes a standalone leading eyebrow band before the hero block", () => {
    const html = page(
      `<div class="band">THE STUDIO · HÄRJEDALEN, SE</div><section><h1>Thrown on a kick wheel today.</h1></section>`,
    )
    expect(guard(html).counts.byRule["hero-kicker-eyebrow"]).toBe(1)
    expect(fix(html).html).not.toContain("THE STUDIO")
  })

  it("never touches navs, non-prose H1s, or long intro paragraphs", () => {
    const html = page(
      `<nav><a href="/">Home</a></nav><h1>Skin is a living archive of light.</h1>` +
        `<div><p>UP</p><h1>8.42km</h1></div>`,
    )
    expect(guard(html).counts.byRule["hero-kicker-eyebrow"]).toBeUndefined()
    expect(fix(html).html).toContain("Home")
  })
})

describe("redundant chrome", () => {
  it("strips a repeated colored edge rail but keeps the selected state's", () => {
    const html = page(
      `<div class="row" style="border-left:4px solid #e2725b">Standups</div>`,
      `<style>.pick.selected{border-left:4px solid #e2725b}</style>`,
    )
    expect(guard(html).counts.byRule["edge-stripe"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).not.toContain('style="border-left')
    expect(fixed).toContain(".pick.selected{border-left:4px solid #e2725b}")
  })

  it("spares hairline-width edges", () => {
    const html = page(`<div style="border-left:1px solid #ddd">quote</div>`)
    expect(guard(html).counts.byRule["edge-stripe"]).toBeUndefined()
  })

  it("drops the border on a filled card, keeping fill and radius", () => {
    const html = page(
      `<div style="background:#f6f1ea; border:1px solid #d8cfc2; border-radius:12px">card</div>`,
    )
    expect(guard(html).counts.byRule["redundant-border"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).toContain("background:#f6f1ea")
    expect(fixed).toContain("border-radius:12px")
    expect(fixed).not.toContain("border:1px solid #d8cfc2")
  })

  it("leaves control borders and low-alpha hairlines alone", () => {
    const html = page(
      `<button style="background:#111;border:1px solid #333">Go</button>` +
        `<div style="background:#fff;border:1px solid rgba(0,0,0,0.05);border-radius:8px">soft</div>`,
    )
    expect(guard(html).counts.byRule["redundant-border"]).toBeUndefined()
  })
})

describe("headline consistency", () => {
  it("re-inks an accent-dipped phrase back to the headline color", () => {
    const html = page(
      `<h1>Composed slowly <span style="color:#e2725b">in sequence.</span></h1>`,
    )
    expect(guard(html).counts.byRule["multicolor-heading"]).toBe(1)
    expect(fix(html).html).toContain("color:inherit")
  })

  it("spares stat headings, wholly-colored headlines, and replicate mode", () => {
    const clean = page(
      `<h1>8.42<span style="color:#e2725b">km</span></h1>` +
        `<h2><span style="color:#e2725b">All of this is one color.</span></h2>`,
    )
    expect(guard(clean).counts.byRule["multicolor-heading"]).toBeUndefined()
    const dipped = page(
      `<h1>Composed slowly <span style="color:#e2725b">in sequence.</span></h1>`,
    )
    expect(
      guard(dipped, { replicate: true }).counts.byRule["multicolor-heading"],
    ).toBeUndefined()
  })

  it("uprights a mid-headline italic swerve, sparing wholly italic ones", () => {
    const html = page(
      `<h1>Thrown on a kick wheel. <em>Fired three times.</em></h1>` +
        `<h2 style="font-style:italic">Fired three times over again.</h2>`,
    )
    expect(guard(html).counts.byRule["mixed-style-headline"]).toBe(1)
    expect(fix(html).html).toContain("font-style:normal")
  })
})

describe("list-row family (advisory)", () => {
  const rows = (inner: string, n = 2, cls = "row", tag = "li") =>
    Array.from({ length: n }, () => `<${tag} class="${cls}">${inner}</${tag}>`).join("")

  it("flags repeated kicker-led rows without failing the verdict", () => {
    const html = page(
      `<ul>${rows(
        `<div>LOCAL FAVORITE · 96 RAVING</div><div>Sourdough house on 5th</div>`,
      )}</ul>`,
    )
    const check = guard(html)
    expect(check.counts.byRule["row-kicker-eyebrow"]).toBe(2)
    expect(check.pass).toBe(true)
    expect(check.severity).toBe(0)
    expect(check.issues.some((i) => i.includes("[advisory]"))).toBe(true)
  })

  it("flags wrapping quotes inside repeated rows", () => {
    const html = page(
      `<ul>${rows(`<div>Corner Bakery</div><p>"Best sourdough in the city"</p>`)}</ul>`,
    )
    expect(guard(html).counts.byRule["multiline-row-meta"]).toBe(2)
  })

  it("flags rows past the 3-slot budget but never counts icon glyphs as media", () => {
    const stuffed = rows(
      `<img src="a.jpg" alt="x"><div>LOCAL PICK</div><div>Corner Bakery</div><div>Mission district</div><div>Fresh at 7am daily</div><div>0.3 miles away</div>`,
    )
    expect(guard(page(`<ul>${stuffed}</ul>`)).counts.byRule["overstuffed-row"]).toBe(2)
    const lean = rows(
      `<svg viewBox="0 0 24 24"></svg><div>Corner Bakery</div><div>Mission district</div><div>Fresh at 7am</div>`,
    )
    expect(guard(page(`<ul>${lean}</ul>`)).counts.byRule["overstuffed-row"]).toBeUndefined()
  })

  it("flags a uniform text feed carded row by row", () => {
    const html = page(
      `<div>${rows(
        `<img src="a.jpg" alt=""><div>Coffee with Sam</div><div>Yesterday, 4pm</div>`,
        3,
        "feedrow",
        "div",
      )}</div>`,
      `<style>.feedrow{border-radius:12px;background:#fff}</style>`,
    )
    expect(guard(html).counts.byRule["row-as-card"]).toBe(1)
  })

  it("honors per-row opt-outs", () => {
    const html = page(
      `<ul>${rows(
        `<div>LOCAL FAVORITE · 96 RAVING</div><div>Sourdough house on 5th</div>`,
        2,
      ).replaceAll("<li class=\"row\">", `<li class="row" data-slop-allow="row-kicker-eyebrow">`)}</ul>`,
    )
    expect(guard(html).counts.byRule["row-kicker-eyebrow"]).toBeUndefined()
  })
})

describe("layout collapse + perf", () => {
  it("regates an ungated reveal selector so content can appear", () => {
    const html = page(
      `<div class="reveal in">Below the hero</div>`,
      `<style>html.js .reveal{opacity:0}.reveal.in{opacity:1}</style>`,
    )
    expect(guard(html).counts.byRule["reveal-specificity-trap"]).toBe(1)
    const fixed = fix(html).html
    expect(fixed).toContain("html.js .reveal.in{opacity:1}")
    expect(fix(fixed).html).toBe(fixed)
  })

  it("prunes will-change down to compositable properties", () => {
    const html = page(
      `<div>x</div>`,
      `<style>.a{will-change:top,transform}.b{will-change:all}.c{will-change:opacity}</style>`,
    )
    expect(guard(html).counts.byRule["will-change-misuse"]).toBe(2)
    const fixed = fix(html).html
    expect(fixed).toContain("will-change: transform")
    expect(fixed).not.toContain("will-change:all")
    expect(fixed).toContain("will-change:opacity")
  })
})

describe("image-outline base polish", () => {
  it("injects the hairline once, picking white on dark grounds", () => {
    const light = page(`<img src="a.jpg" alt="a">`)
    const lightFixed = fix(light).html
    expect(lightFixed).toContain('id="gesso-image-outline"')
    expect(lightFixed).toContain("rgba(0,0,0,0.05)")
    expect(fix(lightFixed).html).toBe(lightFixed)

    const dark = page(
      `<img src="a.jpg" alt="a">`,
      `<style>body{background:#0a0a0a}</style>`,
    )
    expect(fix(dark).html).toContain("rgba(255,255,255,0.05)")
  })

  it("never counts toward the verdict and skips fragments", () => {
    const html = page(`<img src="a.jpg" alt="a">`)
    const check = guard(html)
    expect(check.counts.byRule["image-outline"]).toBeUndefined()
    expect(fix(`<img src="a.jpg" alt="a">`).html).not.toContain("gesso-image-outline")
  })
})

describe("0.4.0 idempotency", () => {
  it("fixing twice is a no-op across the new fixers", () => {
    const html = page(
      `<section><p style="text-transform:uppercase">STUDIO NORTH · EST 2019</p><h1>Objects that earn their keep.</h1></section>` +
        `<div class="hero-meta"><span>VOL. 02 / 2025</span><span>Catalogue QX-IDX-114</span></div>` +
        `<h2>Made slowly <span style="color:#e2725b">by hand.</span></h2>` +
        `<div style="background:#f6f1ea; border:1px solid #d8cfc2; border-radius:12px">card</div>` +
        `<div style="border-left:5px solid #e2725b">rail</div>` +
        `<img src="a.jpg" alt="a">`,
      `<style>html.js .reveal{opacity:0}.reveal.in{opacity:1}.a{will-change:top}</style>`,
    )
    const once = fix(html).html
    const twice = fix(once).html
    expect(twice).toBe(once)
    expect(guard(once).pass).toBe(true)
  })
})
