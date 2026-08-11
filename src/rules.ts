// Anti-slop: the flagship rule registry.
//
// A curated subset of the rules battle-tested inside Gesso's generation
// pipeline: universal generated-UI tells that hold on any HTML/CSS, with
// deterministic, idempotent fixes. Token references are neutral here
// (currentColor / plain rgba fallbacks); hosts with a design system can
// swap fix targets by shipping their own rules alongside these.
//
// Most rules carry a deterministic fix; a few are detect-only (tier "gate")
// because no regex rewrite could be design-preserving (naming the right
// transition properties, writing real copy, choosing a real image).
//
// Escape hatch for a deliberately "slop-shaped" element:
//   - element rules: a `data-slop-allow="rule-id ..."` attribute,
//   - CSS-group rules: a `--slop-allow: rule-id ...` custom property in the
//     same declaration block. Value is a space/comma list of ids, or "all".

import { parse, type HTMLElement } from "node-html-parser"

import type { SlopCtx, SlopHit, SlopRule } from "./types.js"

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const COLOR_RE =
  /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|red|blue|green|orange|purple|pink|yellow|cyan|magenta|gray|grey|navy|teal|gold|crimson|coral|indigo|violet|slate|amber|emerald|rose|sky|lime)\b/

function firstColor(s: string): string | null {
  const m = s.match(COLOR_RE)
  return m ? m[0] : null
}

/** Visible text length of an element's inner HTML (tags + runs collapsed). */
function visibleLen(inner: string): number {
  return inner
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/gi, "x")
    .replace(/\s+/g, " ")
    .trim().length
}

/** Does a slop-allow value list cover this rule id (or "all")? */
function allowListHas(raw: string | null | undefined, ruleId: string): boolean {
  if (!raw) return false
  const tokens = raw.toLowerCase().split(/[\s,]+/).filter(Boolean)
  return tokens.includes("all") || tokens.includes(ruleId)
}

/** CSS-group opt-out: a `--slop-allow: ...` custom property inside the decls. */
function declsAllow(decls: string, ruleId: string): boolean {
  const m = decls.match(/--slop-allow\s*:\s*([^;}]+)/i)
  return allowListHas(m?.[1] ?? null, ruleId)
}

/** Element opt-out: a `data-slop-allow="..."` attribute inside a tag string. */
function tagAllows(tagOrAttrs: string, ruleId: string): boolean {
  const m = tagOrAttrs.match(/\bdata-slop-allow\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
  return allowListHas(m?.[1] ?? m?.[2] ?? null, ruleId)
}

// Strip CSS block comments so a literal `}` or `;` inside `/* ... */` can't
// defeat the brace/semicolon splitters.
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

/** Count <style> rule bodies + inline style="" values matching `predicate`. */
function eachStyleAndInline(
  html: string,
  predicate: (decls: string) => boolean,
): number {
  let n = 0
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of stripCssComments(block[1]).matchAll(/[^{}]+\{([^{}]*)\}/g)) {
      if (predicate(rule[1])) n++
    }
  }
  for (const inline of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
    if (predicate(inline[1])) n++
  }
  return n
}

/**
 * Rewrite every <style> rule body + inline style="" value whose declarations
 * match `predicate`, via `transform`.
 */
function rewriteCssGroups(
  html: string,
  predicate: (decls: string) => boolean,
  transform: (decls: string) => string,
): string {
  let out = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css: string) => {
    const clean = stripCssComments(css)
    const fixed = clean.replace(
      /([^{}]+)\{([^{}]*)\}/g,
      (rule: string, sel: string, body: string) =>
        predicate(body) ? `${sel}{${transform(body)}}` : rule,
    )
    return fixed === clean ? full : full.replace(css, () => fixed)
  })
  out = out.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (full, val: string) =>
    predicate(val) ? ` style="${transform(val)}"` : full,
  )
  return out
}

/** Map `fn` over text-node content only, skipping <style>/<script>/comments. */
const PROTECTED_SPAN_RE =
  /<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>|<!--[\s\S]*?-->/gi

function eachVisibleText(html: string, fn: (text: string) => string): string {
  const transform = (chunk: string): string =>
    chunk.replace(/>([^<]+)</g, (_full, text: string) => `>${fn(text)}<`)
  let out = ""
  let last = 0
  for (const m of html.matchAll(PROTECTED_SPAN_RE)) {
    out += transform(html.slice(last, m.index ?? 0)) + m[0]
    last = (m.index ?? 0) + m[0].length
  }
  return out + transform(html.slice(last))
}

/** Apply `fn` only to markup OUTSIDE script/style/comment regions. */
const RAW_REGION_RE =
  /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi

function outsideRawRegions(html: string, fn: (chunk: string) => string): string {
  let out = ""
  let last = 0
  for (const m of html.matchAll(RAW_REGION_RE)) {
    out += fn(html.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + fn(html.slice(last))
}

// ---- gradient-text ---------------------------------------------------------

const GRADIENT_FN_RE =
  /(?:repeating-)?(?:linear|radial|conic)-gradient\s*\([^()]*(?:\([^()]*\)[^()]*)*\)/i

function isGradientTextGroup(decls: string): boolean {
  if (declsAllow(decls, "gradient-text")) return false // intentional opt-out
  const clipsToText = /(?:^|[\s;{])(?:-webkit-)?background-clip\s*:\s*text/i.test(decls)
  const transparentFill =
    /(?:^|[\s;{])(?:color|(?:-webkit-)?text-fill-color|fill)\s*:\s*transparent/i.test(decls)
  return clipsToText && transparentFill
}

function fixGradientTextGroup(decls: string): string {
  const grad = decls.match(GRADIENT_FN_RE)?.[0] ?? ""
  const stop = (grad && firstColor(grad)) || "currentColor"
  return decls
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      if (/^(?:-webkit-)?background-clip\s*:\s*text$/i.test(d)) return false
      if (/^background(?:-image)?\s*:/i.test(d) && GRADIENT_FN_RE.test(d)) return false
      return true
    })
    .map((d) =>
      /^(?:color|(?:-webkit-)?text-fill-color|fill)\s*:\s*transparent$/i.test(d)
        ? `${d.split(":")[0].trim()}: ${stop}`
        : d,
    )
    .join("; ")
}

// ---- hollow-text -----------------------------------------------------------

function isHollowTextGroup(decls: string): boolean {
  const hasStroke = /(?:^|[\s;{])(?:-webkit-)?text-stroke(?:-width|-color)?\s*:/i.test(decls)
  const transparentFill =
    /(?:^|[\s;{])(?:color|(?:-webkit-)?text-fill-color|fill)\s*:\s*transparent/i.test(decls)
  return hasStroke && transparentFill && !isGradientTextGroup(decls)
}

function fixHollowTextGroup(decls: string): string {
  return decls
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !/^(?:-webkit-)?text-stroke(?:-width|-color)?\s*:/i.test(d))
    .map((d) =>
      /^(?:color|(?:-webkit-)?text-fill-color|fill)\s*:\s*transparent$/i.test(d)
        ? `${d.split(":")[0].trim()}: currentColor`
        : d,
    )
    .join("; ")
}

// ---- indigo-accent ---------------------------------------------------------

const INDIGO_HEX_SRC =
  "#(?:6366f1|818cf8|4f46e5|4338ca|3730a3|8b5cf6|7c3aed|6d28d9|a78bfa|5b21b6)\\b"
const indigoHexRe = (): RegExp => new RegExp(INDIGO_HEX_SRC, "gi")

function declHasIndigo(decl: string): boolean {
  const ci = decl.indexOf(":")
  if (ci < 0) return false
  const prop = decl.slice(0, ci).trim().toLowerCase()
  // Skip custom-property DEFINITIONS (rewriting --accent:#6366f1 to
  // var(--accent) would self-reference) and `content` literals; skip values
  // with url(...) (an indigo hex there is an SVG fragment id).
  if (prop.startsWith("--") || prop === "content") return false
  const val = decl.slice(ci + 1)
  if (/url\(/i.test(val)) return false
  return indigoHexRe().test(val)
}

function groupHasIndigo(decls: string): boolean {
  return decls.split(";").some((d) => declHasIndigo(d.trim()))
}

function fixIndigoGroup(decls: string): string {
  return decls
    .split(";")
    .map((d) => {
      const t = d.trim()
      return declHasIndigo(t)
        ? t.replace(indigoHexRe(), "var(--accent, currentColor)")
        : t
    })
    .filter(Boolean)
    .join("; ")
}

// ---- heavy-box-shadow ------------------------------------------------------

const SHADOW_FLATTEN_TARGET = "0 1px 2px rgba(0,0,0,0.06)"

function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of value) {
    if (ch === "(") depth++
    else if (ch === ")") depth = Math.max(0, depth - 1)
    if (ch === "," && depth === 0) {
      parts.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

function parseAlpha(raw: string): number {
  const t = raw.trim()
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return 1
  return t.endsWith("%") ? n / 100 : n
}

function shadowLayerAlpha(layer: string): number {
  const fn = layer.match(/(?:rgba?|hsla?)\(([^)]*)\)/i)
  if (fn) {
    const inner = fn[1].trim()
    const slash = inner.split("/")
    if (slash.length === 2) return parseAlpha(slash[1])
    const parts = inner.split(",").map((s) => s.trim()).filter(Boolean)
    return parts.length >= 4 ? parseAlpha(parts[3]) : 1
  }
  const hex8 = layer.match(/#[0-9a-f]{8}\b/i)
  if (hex8) return parseInt(hex8[0].slice(7, 9), 16) / 255
  return 1
}

function shadowLayerLengths(layer: string): number[] {
  const stripped = layer
    .replace(/(?:rgba?|hsla?)\([^)]*\)/gi, " ")
    .replace(/var\([^)]*\)/gi, " ")
    .replace(/#[0-9a-f]+/gi, " ")
  return (stripped.match(/-?\d*\.?\d+/g) ?? []).map(Number).filter(Number.isFinite)
}

/** Is this box-shadow VALUE slop: >=3 stacked layers, 2 layers heavier than a
 * subtle Material pair, or one blurred layer at alpha > 0.30? Excludes inset,
 * hard-offset (blur 0), and token vars. */
function boxShadowIsSlop(value: string): boolean {
  const v = value.trim()
  if (!v || /^none$/i.test(v)) return false
  if (/var\(\s*--[a-z-]*shadow/i.test(v)) return false // already a token
  let outerBlurred = 0
  let maxOuterAlpha = 0
  for (const layer of splitTopLevelCommas(v)) {
    if (/\binset\b/i.test(layer)) continue
    const lengths = shadowLayerLengths(layer)
    const blur = lengths.length >= 3 ? lengths[2] : 0
    if (blur > 0) {
      outerBlurred++
      maxOuterAlpha = Math.max(maxOuterAlpha, shadowLayerAlpha(layer))
    }
  }
  if (outerBlurred >= 3) return true
  if (outerBlurred >= 2 && maxOuterAlpha > 0.12) return true
  if (outerBlurred === 1 && maxOuterAlpha > 0.3) return true
  return false
}

const boxShadowDeclRe = (): RegExp =>
  /((?:^|[;{\s])(?:-webkit-|-moz-)?box-shadow\s*:\s*)([^;}]+)/gi

function groupHasSlopShadow(decls: string): boolean {
  // Honor the pack-wide `--slop-allow` opt-out here too: a declaration group
  // that names its own shadow as intentional is stating a design decision,
  // and the fixer must not flatten it. (The border and fill families already
  // consult the opt-out; this predicate was the gap.)
  if (declsAllow(decls, "heavy-box-shadow")) return false
  for (const m of decls.matchAll(boxShadowDeclRe())) {
    if (boxShadowIsSlop(m[2])) return true
  }
  return false
}

function flattenSlopShadows(decls: string): string {
  return decls.replace(boxShadowDeclRe(), (full, pre: string, val: string) =>
    boxShadowIsSlop(val) ? `${pre}${SHADOW_FLATTEN_TARGET}` : full,
  )
}

// ---- gradient-border -------------------------------------------------------

const GRADIENT_BORDER_RE =
  /border-image(?:-source)?\s*:\s*[^;"}']*(?:linear|radial|conic)-gradient[^;"}']*/gi
const GRADIENT_BORDER_STRIP_RE =
  /\s*border-image(?:-source)?\s*:\s*[^;"}']*(?:linear|radial|conic)-gradient[^;"}']*;?/gi

// ---- decorative-divider ----------------------------------------------------

// Box-drawing runs (U+2500-2570, U+2574-257F; diagonals spared) and em/en
// dash runs, written as unicode escapes so the source stays dash-free.
const BOXRUN_RE = /[\u2500-\u2570\u2574-\u257F]{2,}/g
const DASHRUN_RE = /[\u2014\u2013]{2,}/g

function detectDecorativeDividers(html: string): SlopHit[] {
  const hits: SlopHit[] = []
  eachVisibleText(html, (text) => {
    for (const m of text.matchAll(BOXRUN_RE))
      hits.push({ ruleId: "decorative-divider", detail: `box-drawing "${m[0].slice(0, 8)}"` })
    for (const m of text.matchAll(DASHRUN_RE))
      hits.push({ ruleId: "decorative-divider", detail: `dash run "${m[0].slice(0, 8)}"` })
    return text // detect-only: never mutate
  })
  return hits
}

// ---- broken-image ----------------------------------------------------------

const IMG_TAG_RE = /<img\b[^>]*>/gi

/** Photo-pipeline slots a host resolver fills post-generation (sanctioned). */
const RESOLVER_SLOT_RE =
  /\bdata-photo-query\b|\bdata-photo-placeholder\b|\bdata-illustration\b|\bdata-attachment-ref\b/i

function isBrokenImg(tag: string): boolean {
  // Photo-pipeline slots intentionally ship without a src (a host resolver
  // fills them post-generation); treat the marker attributes as sanctioned.
  // data-attachment-ref is the same: a placed/pending user asset a host
  // resolver fills with the stored URL, so a src-less one is not broken.
  if (RESOLVER_SLOT_RE.test(tag)) {
    return false
  }
  if (tagAllows(tag, "broken-image")) return false
  const srcM = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
  if (!srcM) return true
  const raw = (srcM[1] ?? srcM[2] ?? srcM[3] ?? "").trim()
  if (raw === "") return true
  const low = raw.toLowerCase()
  if (["#", "about:blank", "undefined", "null", "todo"].includes(low)) return true
  if (/^\{\{.*\}\}$/.test(raw)) return true // {{template}} placeholders
  if (/^(?:placeholder|your-image-here)\b/.test(low)) return true
  if (/path\/to\//.test(low)) return true
  if (/example\.com\/(?:placeholder|img|image)/.test(low)) return true
  return false
}

// ---- emoji-icon ------------------------------------------------------------

const EMOJI_BASE = "[\\u{1F300}-\\u{1FAFF}\\u{1F000}-\\u{1F0FF}\\u{1F1E6}-\\u{1F1FF}]"
const EMOJI_MOD = "[\\uFE0F\\u200D\\u20E3]"
const emojiIconRe = (): RegExp =>
  new RegExp(
    `(<(?:a|button|h[1-6]|span|li|dt|dd|figcaption|label|strong|b|small)\\b[^>]*>)\\s*(?:${EMOJI_MOD}*${EMOJI_BASE}${EMOJI_MOD}*)+\\s*(?=[\\p{L}\\p{N}])`,
    "giu",
  )

// ---- cents-suffix ----------------------------------------------------------

const PRICE_PREFIX = "(?:[$£€¥]\\s?\\d[\\d,]*|\\d{1,3}(?:,\\d{3})+)"
const centsRe = (): RegExp =>
  new RegExp(`(${PRICE_PREFIX})\\.?\\s*<span\\b[^>]*>\\s*\\.?\\d{1,2}\\s*</span>`, "gi")

function fixCents(html: string): string {
  let prev = ""
  let out = html
  for (let i = 0; i < 8 && out !== prev; i++) {
    prev = out
    out = out.replace(centsRe(), "$1")
  }
  return out
}

// ---- oversized-number ------------------------------------------------------

const OVERSIZED_NUM_THRESHOLD = 10_000

const OVERSIZED_NUM_RE =
  /(?<![\w.])([$£€¥₹]?)(\d{1,3}(?:,\d{3})+|\d{5,})(\.\d+)?(?![\d,]*\.?\d*\s*[%kKmMbB])/g

const ABBR_TIERS: ReadonlyArray<{ v: number; s: string }> = [
  { v: 1e9, s: "B" },
  { v: 1e6, s: "M" },
  { v: 1e3, s: "K" },
]

function oversizedValue(intPart: string, decPart: string | undefined): number {
  return parseFloat(intPart.replace(/,/g, "") + (decPart ?? ""))
}

function abbreviateMagnitude(value: number): string {
  for (const { v, s } of ABBR_TIERS) {
    if (value >= v) return `${Math.round((value / v) * 10) / 10}${s}`
  }
  return `${Math.round(value)}`
}

function detectOversizedNumbers(html: string): SlopHit[] {
  const hits: SlopHit[] = []
  eachVisibleText(html, (text) => {
    for (const m of text.matchAll(OVERSIZED_NUM_RE)) {
      if (oversizedValue(m[2] ?? "", m[3]) >= OVERSIZED_NUM_THRESHOLD) {
        hits.push({
          ruleId: "oversized-number",
          detail: `${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`,
        })
      }
    }
    return text // detect-only: never mutate
  })
  return hits
}

function fixOversizedNumbers(html: string): string {
  return eachVisibleText(html, (text) =>
    text.replace(
      OVERSIZED_NUM_RE,
      (full, cur: string, intPart: string, dec: string | undefined) => {
        const value = oversizedValue(intPart, dec)
        return value >= OVERSIZED_NUM_THRESHOLD
          ? `${cur}${abbreviateMagnitude(value)}`
          : full
      },
    ),
  )
}

// ---- transition-all --------------------------------------------------------

function declIsTransitionAll(decl: string): boolean {
  const ci = decl.indexOf(":")
  if (ci < 0) return false
  const prop = decl
    .slice(0, ci)
    .trim()
    .toLowerCase()
    .replace(/^-(?:webkit|moz|o)-/, "")
  if (prop !== "transition" && prop !== "transition-property") return false
  return /\ball\b/i.test(decl.slice(ci + 1))
}

function groupHasTransitionAll(decls: string): boolean {
  if (declsAllow(decls, "transition-all")) return false
  return decls.split(";").some((d) => declIsTransitionAll(d.trim()))
}

// ---- em-dash-copy ----------------------------------------------------------

// A SINGLE em dash (U+2014) in visible copy: the most recognizable
// generated-text tell; runs of 2+ are decorative-divider's turf. Also catches
// the entity forms and a spaced en dash (U+2013) standing in for one.
// Unspaced en dashes are spared: they are legitimate ranges (1-5, Mon-Fri).
// The dash characters are built from char codes so this source file stays
// dash-free, the same discipline the rule enforces.
const EM_DASH = String.fromCharCode(0x2014)
const EN_DASH = String.fromCharCode(0x2013)
const EMDASH_ENTITY_SRC = "&mdash;|&#8212;|&#x2014;"
const EMDASH_SINGLE_SRC = `(?<!${EM_DASH})${EM_DASH}(?!${EM_DASH})`

function countEmDashes(text: string): number {
  return (
    [...text.matchAll(new RegExp(EMDASH_ENTITY_SRC, "gi"))].length +
    [...text.matchAll(new RegExp(EMDASH_SINGLE_SRC, "g"))].length +
    [...text.matchAll(new RegExp(`(?<=\\s)${EN_DASH}(?=\\s)`, "g"))].length
  )
}

function fixEmDashes(text: string): string {
  return text
    .replace(new RegExp(`\\s*(?:${EMDASH_ENTITY_SRC})\\s*`, "gi"), ", ")
    .replace(new RegExp(`\\s*${EMDASH_SINGLE_SRC}\\s*`, "g"), ", ")
    .replace(new RegExp(`\\s+${EN_DASH}\\s+`, "g"), ", ")
    .replace(/^(\s*),\s*/, "$1") // a dash that OPENED the text node leaves no comma
}

// ---- lorem-ipsum -----------------------------------------------------------

const LOREM_SRC = "\\blorem\\s+ipsum\\b|\\bdolor\\s+sit\\s+amet\\b"

// ---- missing-alt -----------------------------------------------------------

function isAltlessImg(tag: string): boolean {
  if (RESOLVER_SLOT_RE.test(tag)) return false // resolver owns the slot's alt
  if (tagAllows(tag, "missing-alt")) return false
  if (isBrokenImg(tag)) return false // broken-image already owns this tag
  return !/\balt\s*=/i.test(tag)
}

// ---- placeholder-image -----------------------------------------------------

const PLACEHOLDER_HOST_RE =
  /\bsrc\s*=\s*["']?(?:https?:)?\/\/(?:www\.)?(?:i\.pravatar\.cc|randomuser\.me|ui-avatars\.com|api\.dicebear\.com|placekitten\.com|placehold\.co|via\.placeholder\.com|placeimg\.com|dummyimage\.com|fakeimg\.pl|lorempixel\.com|loremflickr\.com|picsum\.photos|source\.unsplash\.com)\b/i

function isPlaceholderServiceImg(tag: string): boolean {
  if (tagAllows(tag, "placeholder-image")) return false
  return PLACEHOLDER_HOST_RE.test(tag)
}

// ---------------------------------------------------------------------------
// DOM utilities (structural rules)
//
// Some tells are relationships between elements (a badge floated over a hero
// headline, ticks sprayed on a gauge), not a single declaration. Those rules
// PARSE the HTML with node-html-parser; nothing is ever executed. Every
// detect/fix stays wrapped in the engine's try/catch, and every DOM fixer
// early-returns the input string untouched when it finds no targets, so a
// clean file is never reserialized.
// ---------------------------------------------------------------------------

function tagOf(el: HTMLElement): string {
  return (el.tagName ?? "").toLowerCase()
}

function elClass(el: HTMLElement): string {
  return (el.getAttribute("class") ?? "").trim()
}

/** Element opt-out: a `data-slop-allow="..."` attribute on the element. */
function elAllows(el: HTMLElement, ruleId: string): boolean {
  return allowListHas(el.getAttribute("data-slop-allow"), ruleId)
}

/** data-slop-allow opt-out checked on `el` and every ancestor up to `stop`. */
function allowsUpTo(el: HTMLElement, ruleId: string, stop: HTMLElement): boolean {
  for (let p: HTMLElement | null = el; p; p = p.parentNode as HTMLElement | null) {
    if (elAllows(p, ruleId)) return true
    if (p === stop) break
  }
  return false
}

/** Naive cascade: class name -> concatenated declaration bodies from <style>. */
function collectClassDecls(html: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = stripCssComments(m[1])
    for (const rm of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const cm of rm[1].matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        map.set(cm[1], `${map.get(cm[1]) ?? ""};${rm[2]}`)
      }
    }
  }
  return map
}

/** An element's effective declarations: inline style + its classes' bodies. */
function elDecls(el: HTMLElement, map: Map<string, string>): string {
  let d = el.getAttribute("style") ?? ""
  for (const c of elClass(el).split(/\s+/).filter(Boolean)) d += `;${map.get(c) ?? ""}`
  return d
}

function isDescendantOf(child: HTMLElement, ancestor: HTMLElement): boolean {
  for (let p = child.parentNode as HTMLElement | null; p; p = p.parentNode as HTMLElement | null)
    if (p === ancestor) return true
  return false
}

/**
 * Split a CSS value on `sep` at the TOP level only (never inside parens, so
 * cubic-bezier(0.4, 0, 0.2, 1) stays a single token).
 */
function splitTopLevel(value: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of value) {
    if (ch === "(") depth++
    else if (ch === ")") depth = Math.max(0, depth - 1)
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/**
 * Replace every `startRe(`...`)` span (balanced parens) in `src` via
 * `transform`. Bails on unbalanced input rather than corrupting output.
 */
function replaceBalanced(
  src: string,
  startRe: RegExp,
  transform: (full: string, inner: string) => string,
): { out: string; count: number } {
  let out = ""
  let count = 0
  let i = 0
  startRe.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = startRe.exec(src)) !== null) {
    const start = m.index
    const openParen = start + m[0].length - 1 // index of "("
    let depth = 0
    let j = openParen
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === "(") depth++
      else if (c === ")") {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) break // unbalanced: bail rather than corrupt output
    const end = j + 1
    out += src.slice(i, start) + transform(src.slice(start, end), src.slice(openParen + 1, j))
    count++
    i = end
    startRe.lastIndex = end
  }
  out += src.slice(i)
  return { out, count }
}

// ---- entity-fill gradient helpers (gradient-fill / multicolor-fill) -------
//
// A rounded ENTITY (icon tile, card, chip, avatar, filled button) whose
// background is a GRADIENT is a top generated-UI tell. Two sibling FIX rules
// split by hue count:
//   - gradient-fill:   a SINGLE-hue gradient fill, flattened to a SOLID color
//                      (the first saturated stop). Solid saturated tiles are
//                      legitimate; only the gradient is slop.
//   - multicolor-fill: a MULTI-hue gradient fill (pink to purple, orange to
//                      pink) can't fairly keep one of several competing hues,
//                      so it is muted to a neutral surface tone.
//
// SCOPE: an entity is discriminated by `border-radius` in the SAME declaration
// block as the gradient background. That spares full-bleed page/section/hero
// gradients (no radius) while catching every rounded tile/card/chip/button.
//
// CARVE-OUTS so a legitimate fill is never broken:
//   - background-clip:text            -> gradient-text owns it.
//   - ANY url() in a background decl   -> a photo + scrim, not a tile fill.
//   - NO saturated color stop (pure black/white scrims and tints, or all-var
//     gradients we can't read)         -> not a "color" tell; left intact.

const ENTITY_BG_PROPS = new Set(["background", "background-image", "background-color"])
const GRADIENT_FN_START_RE = /\b(?:linear|radial|conic)-gradient\s*\(/gi
const HUE_TOL = 28 // degrees; two stops are the same hue family when closer
const SAT_MIN = 0.15 // below this a stop is achromatic (scrim/tint), ignored
const MUTED_ENTITY_FILL = "var(--surface, rgba(128,128,128,0.12))"

/** Split "prop: value" declarations on top-level `;`, lower-casing the prop. */
function splitDeclList(decls: string): { prop: string; val: string }[] {
  return stripCssComments(decls)
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":")
      return i < 0
        ? { prop: "", val: d }
        : { prop: d.slice(0, i).trim().toLowerCase(), val: d.slice(i + 1).trim() }
    })
}

/** The first NON-repeating gradient function (balanced parens) in a value, or
 * null. `repeating-*-gradient` is the repeating-gradient-stripe rule's job. */
function firstNonRepeatGradient(value: string): string | null {
  GRADIENT_FN_START_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = GRADIENT_FN_START_RE.exec(value)) !== null) {
    if (/repeating-$/i.test(value.slice(Math.max(0, m.index - 10), m.index))) continue
    const openParen = m.index + m[0].length - 1
    let depth = 0
    for (let j = openParen; j < value.length; j++) {
      const c = value[j]
      if (c === "(") depth++
      else if (c === ")" && --depth === 0) return value.slice(m.index, j + 1)
    }
    return null // unbalanced: bail
  }
  return null
}

/** The first gradient-bearing BACKGROUND value in a decl block, or null. Bails
 * (null) if ANY background decl carries a url(): that's a photo composition,
 * and collapsing it would delete the image. */
function entityBgGradientValue(decls: string): string | null {
  let found: string | null = null
  for (const { prop, val } of splitDeclList(decls)) {
    if (!ENTITY_BG_PROPS.has(prop)) continue
    if (/\burl\s*\(/i.test(val)) return null
    if (!found) found = firstNonRepeatGradient(val)
  }
  return found
}

const NAMED_RGB: Record<string, [number, number, number]> = {
  white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], blue: [0, 0, 255],
  green: [0, 128, 0], orange: [255, 165, 0], purple: [128, 0, 128], pink: [255, 192, 203],
  yellow: [255, 255, 0], cyan: [0, 255, 255], magenta: [255, 0, 255], gray: [128, 128, 128],
  grey: [128, 128, 128], navy: [0, 0, 128], teal: [0, 128, 128], gold: [255, 215, 0],
  crimson: [220, 20, 60], coral: [255, 127, 80], indigo: [75, 0, 130], violet: [238, 130, 238],
  slate: [112, 128, 144], amber: [255, 191, 0], emerald: [16, 185, 129], rose: [244, 63, 94],
  sky: [14, 165, 233], lime: [132, 204, 22],
}

function parseHex(h: string): [number, number, number] | null {
  let s = h.replace("#", "")
  if (s.length === 3 || s.length === 4) s = s.split("").map((c) => c + c).join("")
  if (s.length !== 6 && s.length !== 8) return null
  const [r, g, b] = [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)].map((p) => parseInt(p, 16))
  return [r, g, b].every(Number.isFinite) ? [r, g, b] : null
}

/** Hue (0-360) + saturation (0-1) of a CSS color, or null when unreadable
 * (var()/currentColor/transparent: we can't measure those). */
function colorHueSat(raw: string): { h: number; s: number } | null {
  const c = raw.trim().toLowerCase()
  if (!c || c.startsWith("var(") || c === "transparent" || c === "currentcolor" || c === "inherit")
    return null
  const hslM = c.match(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%/i)
  if (hslM) return { h: ((parseFloat(hslM[1]) % 360) + 360) % 360, s: parseFloat(hslM[2]) / 100 }
  let rgb: [number, number, number] | null = null
  if (c.startsWith("#")) rgb = parseHex(c)
  else {
    const fn = c.match(/rgba?\(([^)]*)\)/i)
    if (fn) {
      const n = fn[1].split(/[\s,/]+/).map(Number).filter(Number.isFinite)
      if (n.length >= 3) rgb = [n[0], n[1], n[2]]
    } else {
      const named = c.match(/^[a-z]+/)?.[0]
      if (named && NAMED_RGB[named]) rgb = NAMED_RGB[named]
    }
  }
  if (!rgb) return null
  const [r, g, b] = rgb.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = (((g - b) / d) % 6 + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60) % 360
  }
  return { h, s }
}

/** Smallest angular distance between two hues, accounting for wraparound. */
function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** A gradient's color-stop tokens (direction / position parts dropped). */
function gradientStopColors(gradientFn: string): string[] {
  const open = gradientFn.indexOf("(")
  const inner = gradientFn.slice(open + 1, gradientFn.lastIndexOf(")"))
  const out: string[] = []
  for (const part of splitTopLevelCommas(inner)) {
    const c = firstColor(part) ?? /(?:^|\s)(var\([^)]*\))/i.exec(part)?.[1] ?? null
    if (c) out.push(c)
  }
  return out
}

/** Classify an entity gradient FILL by readable, saturated hues:
 *  'single' (<=1 hue: flatten to solid), 'multi' (>=2 divergent hues: mute),
 *  or null (no saturated color: a scrim/tint/var gradient, not this slop). */
function gradientFillHueClass(gradientFn: string): "single" | "multi" | null {
  const hues: number[] = []
  for (const c of gradientStopColors(gradientFn)) {
    const hs = colorHueSat(c)
    if (hs && hs.s >= SAT_MIN) hues.push(hs.h)
  }
  if (hues.length === 0) return null
  for (let i = 0; i < hues.length; i++)
    for (let j = i + 1; j < hues.length; j++)
      if (hueDelta(hues[i], hues[j]) > HUE_TOL) return "multi"
  return "single"
}

/** Classify a declaration block's entity gradient fill, or null when it isn't
 * one (no rounded entity, opted out, gradient-text, photo composition, or a
 * scrim/tint we leave alone). One classifier drives BOTH sibling rules. */
function entityFillClass(decls: string): "single" | "multi" | null {
  if (declsAllow(decls, "gradient-fill") || declsAllow(decls, "multicolor-fill")) return null
  if (!/\bborder-radius\s*:/i.test(decls)) return null // not a tile/card/chip/pill
  if (/background-clip\s*:\s*text/i.test(decls)) return null // gradient-text owns it
  const grad = entityBgGradientValue(decls)
  return grad ? gradientFillHueClass(grad) : null
}

const isSingleEntityFill = (decls: string): boolean => entityFillClass(decls) === "single"
const isMultiEntityFill = (decls: string): boolean => entityFillClass(decls) === "multi"

/** First SATURATED stop of a gradient: the color kept when flattening a
 * single-hue fill; falls back to the first readable stop, then the surface. */
function gradientSolidColor(gradientFn: string): string {
  const colors = gradientStopColors(gradientFn)
  for (const c of colors) {
    const hs = colorHueSat(c)
    if (hs && hs.s >= SAT_MIN) return c
  }
  return colors[0] ?? MUTED_ENTITY_FILL
}

/** Collapse every background* declaration in a block to one solid
 * `background: <color>` (single-hue: the saturated stop; multi-hue: muted).
 * Safe because the predicate already excluded url()-bearing blocks. */
function fixEntityFill(decls: string, mode: "single" | "multi"): string {
  const grad = entityBgGradientValue(decls)
  if (!grad) return decls
  const color = mode === "multi" ? MUTED_ENTITY_FILL : gradientSolidColor(grad)
  const out: string[] = []
  let placed = false
  for (const { prop, val } of splitDeclList(decls)) {
    if (!prop) {
      out.push(val)
    } else if (ENTITY_BG_PROPS.has(prop)) {
      if (!placed) {
        out.push(`background: ${color}`)
        placed = true
      }
      // drop any other background* decl; the one solid fill replaces them all
    } else {
      out.push(`${prop}: ${val}`)
    }
  }
  return out.join("; ")
}

// ---- fake-dot-viz ----------------------------------------------------------
//
// A row of >=3 equal, EMPTY dot/node elements faking a "momentum"/"pulse"
// chart wedged into a list row: it conveys nothing and steals space from the
// value column. Anchored on a viz-ish wrapper class so it can't touch
// carousel/pagination indicators or avatar stacks.
const DOT_CLUSTER_RE =
  /<(span|div)\b[^>]*\bclass\s*=\s*"[^"]*\b(?:pulse|momentum|sparkdots?|spark-dots|trend-dots|dot-row|dot-grid|dot-cluster|node-row|nodes)\b[^"]*"[^>]*>(?:\s*<(?:span|div|i)\b[^>]*\bclass\s*=\s*"[^"]*\b(?:dot|node|spark)\b[^"]*"[^>]*>\s*<\/(?:span|div|i)>){3,}\s*<\/\1>/gi

// ---- gauge / arc structural helpers ----------------------------------------
//
// These detectors are STRUCTURAL: they anchor on an "arc/gauge SVG" (an <svg>
// whose <path d> uses an elliptic-arc command with fill:none, or a
// gauge-scaffold marker) and scope every removal to that gauge or its
// container. All removals are design-preserving: the arc, the value, and real
// labels always survive.

const GAUGE_SCAFFOLD_CLASS_RE = /\bgesso-viz-(?:gauge|arc)\b/
const ARC_PATH_CMD_RE = /[Aa]\s*-?\d/ // an elliptic-arc command in path `d`
// Groups whose lines are a legitimate, labelled axis/tick scale: exempt from
// the stray-tick sweep even on a real gauge.
const TICK_GROUP_CLASS_RE = /tick|axis|grid(?:line)?|scale|marks|ruler/i
const STRAY_TICK_MAX_LEN = 16 // viewBox units; real radiating ticks are ~8px
const STRAY_TICK_MIN_COUNT = 3 // a decorative cluster, not a lone mark
// A "value / scale" token (7/10), or a percent value (68%) => scale = 100.
const VIZ_VALUE_SCALE_RE = /(\d{1,3})\s*\/\s*(\d{1,3})\b/
const VIZ_PERCENT_RE = /\d{1,3}\s*%/
// A centered overlay (translate(-50%,-50%)) is an intentional center-of-ring
// glyph, NOT a decorative rim ornament: never stripped.
const CENTERED_TRANSFORM_RE = /translate\(\s*-?50%\s*,\s*-?50%/i
// A text whose x sits within this fraction of the viewBox width counts as the
// centered region (the hero value), not an arc endpoint.
const ENDPOINT_EDGE_FRAC = 0.2
const ENDPOINT_HERO_FONT_PX = 20 // text larger than this is the value, not a label

function isGTagName(el: HTMLElement): boolean {
  return (el.rawTagName ?? "").toLowerCase() === "g"
}

/** An <svg> that renders an arc/gauge: a gauge-scaffold marker, OR a STROKED
 * OPEN arc (fill:none) <path>. The fill:none gate is the gauge tell: it
 * excludes FILLED arcs (pie/donut slices, logos, blobs, speech bubbles) that
 * also use the A/a command but are not gauges. */
function isArcGaugeSvg(svg: HTMLElement): boolean {
  // A catalog icon is never a gauge, even though some glyph paths use arc
  // commands. Excluding it keeps nav/status-bar icons out of the gauge scope.
  if (svg.getAttribute("data-icon")) return false
  const cls = svg.getAttribute("class") ?? ""
  const dataViz = (svg.getAttribute("data-viz") ?? "").toLowerCase()
  if (GAUGE_SCAFFOLD_CLASS_RE.test(cls) || dataViz === "gauge-semi" || dataViz === "progress-arc")
    return true
  for (const p of svg.querySelectorAll("path")) {
    if (!ARC_PATH_CMD_RE.test(p.getAttribute("d") ?? "")) continue
    if ((p.getAttribute("fill") ?? "").trim().toLowerCase() === "none") return true
  }
  return false
}

function arcGaugeSvgs(root: HTMLElement): HTMLElement[] {
  return root.querySelectorAll("svg").filter(isArcGaugeSvg)
}

function svgLineLength(el: HTMLElement): number {
  const n = (a: string) => parseFloat(el.getAttribute(a) ?? "")
  const x1 = n("x1"), y1 = n("y1"), x2 = n("x2"), y2 = n("y2")
  if ([x1, y1, x2, y2].some((v) => !Number.isFinite(v))) return Infinity
  return Math.hypot(x2 - x1, y2 - y1)
}

/** A thin, short <rect> the size of a tick mark (one dimension hairline-thin,
 * the other within the tick-length budget): the rect form of a radiating tick. */
function isShortTickRect(el: HTMLElement): boolean {
  const w = parseFloat(el.getAttribute("width") ?? "")
  const h = parseFloat(el.getAttribute("height") ?? "")
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false
  return Math.min(w, h) <= 4 && Math.max(w, h) <= STRAY_TICK_MAX_LEN
}

/** True if an ancestor up to (incl.) the gauge svg carries a tick/axis/grid
 * class (a legitimate labelled tick group). */
function underTickGroup(el: HTMLElement, stopAt: HTMLElement): boolean {
  for (let p = el.parentNode as HTMLElement | null; p; p = p.parentNode as HTMLElement | null) {
    if (TICK_GROUP_CLASS_RE.test(p.getAttribute("class") ?? "")) return true
    if (p === stopAt) break
  }
  return false
}

/** Effective font-size px for an SVG text: the CSS font-size (inline/class via
 * elDecls), falling back to the SVG font-size attribute. null = unknown. */
function effectiveFontPx(el: HTMLElement, map: Map<string, string>): number | null {
  const m = elDecls(el, map).match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/i)
  if (m) return parseFloat(m[1])
  const attr = parseFloat(el.getAttribute("font-size") ?? "")
  return Number.isFinite(attr) ? attr : null
}

/** Short, ungrouped radiating ticks (<line> or thin <rect>) inside a gauge svg. */
function findStrayVizTicks(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const svg of arcGaugeSvgs(root)) {
    if (elAllows(svg, "viz-stray-ticks")) continue
    const lines = svg
      .querySelectorAll("line")
      .filter((ln) => svgLineLength(ln) <= STRAY_TICK_MAX_LEN && !underTickGroup(ln, svg))
    const rects = svg
      .querySelectorAll("rect")
      .filter((r) => isShortTickRect(r) && !underTickGroup(r, svg))
    const ticks = [...lines, ...rects]
    if (ticks.length >= STRAY_TICK_MIN_COUNT) out.push(...ticks)
  }
  return out
}

function fixStrayVizTicks(html: string): string {
  const root = parse(html)
  const ticks = findStrayVizTicks(root)
  if (ticks.length === 0) return html
  const groups = new Set<HTMLElement>()
  for (const t of ticks) {
    const p = t.parentNode as HTMLElement | null
    if (p && isGTagName(p)) groups.add(p)
    t.remove()
  }
  // Drop wrapper <g>s the ticks left behind ONLY when truly empty (no element
  // children AND no text): a <g> still holding a <text>/<defs> label survives.
  for (const g of groups) {
    if (g.querySelectorAll("*").length === 0 && (g.text ?? "").trim() === "") g.remove()
  }
  return root.toString()
}

/** Endpoint <text> on a gauge ("0" at one rim, "N" at the other) that merely
 * restate a /N (or percent) scale already shown on the value. Three guards
 * keep real data safe: the scale must exist, the two labels must SPAN the arc
 * horizontally (one near the left rim, one near the right; a vertical y-axis
 * with both labels on one side is NOT a gauge scale), and neither may be the
 * large centered hero value (resolved font + center-region exclusion). */
function findRedundantScaleTexts(root: HTMLElement, map: Map<string, string>): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const svg of arcGaugeSvgs(root)) {
    if (elAllows(svg, "viz-redundant-scale")) continue
    const container = (svg.parentNode as HTMLElement | null) ?? svg
    const text = container.text ?? ""
    const slash = text.match(VIZ_VALUE_SCALE_RE)
    const n = slash ? slash[2] : VIZ_PERCENT_RE.test(text) ? "100" : null
    if (!n) continue
    const vb = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/)
    const width = parseFloat(vb[2] ?? "")
    if (!Number.isFinite(width) || width <= 0) continue // can't position-gate => skip (safe)
    const candidates: { el: HTMLElement; frac: number }[] = []
    for (const t of svg.querySelectorAll("text")) {
      const v = (t.text ?? "").trim()
      if (v !== "0" && v !== n) continue
      const x = parseFloat(t.getAttribute("x") ?? "")
      if (!Number.isFinite(x)) continue
      const frac = x / width
      if (frac > ENDPOINT_EDGE_FRAC && frac < 1 - ENDPOINT_EDGE_FRAC) continue // centered region
      const fs = effectiveFontPx(t, map)
      if (fs !== null && fs > ENDPOINT_HERO_FONT_PX) continue // the hero value, not a label
      candidates.push({ el: t, frac })
    }
    // Require a horizontally-spanning pair (one near left rim, one near right):
    // the arc-endpoint signature. A one-sided y-axis never spans, so it's spared.
    const spans =
      candidates.some((c) => c.frac <= ENDPOINT_EDGE_FRAC) &&
      candidates.some((c) => c.frac >= 1 - ENDPOINT_EDGE_FRAC)
    if (spans) out.push(...candidates.map((c) => c.el))
  }
  return out
}

function fixRedundantScaleTexts(html: string): string {
  const root = parse(html)
  const texts = findRedundantScaleTexts(root, collectClassDecls(html))
  if (texts.length === 0) return html
  for (const t of texts) t.remove()
  return root.toString()
}

// ---- glyph-on-metric helpers -----------------------------------------------
//
// A decorative glyph (a raw emoji "figure", a catalog icon, a trend arrow)
// placed ON a numeric value: an emoji centered behind a progress ring's "74%",
// an arrow beside a stat's "12%". The number is the content; the glyph
// collides with or pollutes it. Two branches, one removal pass:
//   A. DATAVIS: a decorative emoji/icon stacked in a viz container that ALSO
//      holds the value in a different branch (the overlap). Remove the wholly
//      decorative wrapper; keep the arc svg and the number.
//   B. PERCENTAGE: every catalog icon and emoji/symbol glyph inside the
//      bounded stat unit around a "NN%" value, scoped so page chrome and
//      neighbouring stats are never reached.

const PERCENT_VALUE_RE = /^[+\-]?\d[\d.,]*\s*%$/
// A datavis value leaf: a percentage, an N/M ratio, a degree, or a bare/abbrev
// number (74%, 7/10, 72, 8.4, 320, 1.2k). Whole-string match, so prose never
// qualifies.
const DATAVIS_VALUE_RE = /^[+\-]?\d[\d.,]*(?:\s*%|\s*\/\s*\d[\d.,]*|\s*°|[kKmMbB])?$/
// A wrapper whose class marks it as pure decoration. Widens removal to the
// whole layer once it is proven to hold no data.
const DECO_LAYER_CLASS_RE =
  /\b(?:illu|illustration|figure|decor(?:ation)?|ornament|blob|orb|glow|halo|backdrop|sticker|mascot|artwork|art)\b/i
// Codepoint ranges that read as a decorative glyph, or that join an emoji
// grapheme via ZWJ: arrows, misc-technical, dingbats, supplemental arrows,
// misc symbols-and-arrows.
const GLYPH_SYMBOL_RANGES = "\\u2190-\\u21FF\\u2300-\\u27BF\\u2900-\\u297F\\u2B00-\\u2BFF"
const EMOJI_INNER = EMOJI_BASE.slice(1, -1)
const HAS_CORE_EMOJI_RE = new RegExp(`[${EMOJI_INNER}]`, "u")
const VISIBLE_GLYPH_RE = new RegExp(`[${EMOJI_INNER}${GLYPH_SYMBOL_RANGES}]`, "u")
// A run made up ONLY of glyph codepoints, modifiers (variation selector, ZWJ,
// keycap), and whitespace; nothing else (no letters, digits, %, currency).
const GLYPH_RUN_RE = new RegExp(
  `^[${EMOJI_INNER}${GLYPH_SYMBOL_RANGES}\\uFE0F\\u200D\\u20E3\\s]+$`,
  "u",
)
const STAT_UNIT_MAX_CHARS = 64
// Page chrome / landmarks the percentage climb must never ascend into, and
// whose icons are never stripped.
const METRIC_CHROME_SEL =
  '[data-brief-role="status-bar"],[data-chrome="status-bar"],[data-brief-role="tab-bar"],[data-brief-role="nav-bottom"],nav.tab-bar,nav'

/** A leaf whose entire text is one or more emoji graphemes (>= 1 core-emoji
 * codepoint): a standalone decorative emoji like <div class="figure">...</div>. */
function isEmojiOnlyElement(el: HTMLElement): boolean {
  if (el.children.length > 0) return false
  const t = (el.text ?? "").trim()
  return !!t && HAS_CORE_EMOJI_RE.test(t) && GLYPH_RUN_RE.test(t)
}

/** A leaf whose entire text is decorative glyphs (emoji OR arrows/dingbats/
 * stars). Broader than isEmojiOnlyElement; used only inside a % stat unit. */
function isGlyphLeaf(el: HTMLElement): boolean {
  if (el.children.length > 0) return false
  const t = (el.text ?? "").trim()
  return !!t && VISIBLE_GLYPH_RE.test(t) && GLYPH_RUN_RE.test(t)
}

/** An icon glyph: an <svg> carrying data-icon or the shared `ic` icon class. */
function isIconGlyph(el: HTMLElement): boolean {
  if ((el.tagName ?? "").toLowerCase() !== "svg") return false
  if (el.getAttribute("data-icon") != null) return true
  return /(?:^|\s)ic(?:$|\s)/.test(el.getAttribute("class") ?? "")
}

/** A catalog icon: isIconGlyph (<svg> with data-icon/.ic) or a non-svg
 * [data-icon] / .ic element. <img> is intentionally NOT an icon (a flag or
 * logo beside a stat can be the data). */
function isCatalogIcon(el: HTMLElement): boolean {
  if (isIconGlyph(el)) return true
  if (tagOf(el) === "svg") return false
  if (el.getAttribute("data-icon") != null) return true
  return /(?:^|\s)ic(?:$|\s)/.test(el.getAttribute("class") ?? "")
}

/** The nearest ancestor that reads as a data-viz container: it carries
 * data-viz, its subtree holds a real arc/gauge svg, or it is ring/gauge-classed. */
const GAUGE_CONTAINER_CLASS_RE =
  /\b(?:gauge|donut|radial|dial|meter|speedometer)\b|(?:progress|activity|score|completion|goal|quota|usage|capacity|percent|pct)[-_]?ring\b|\bring[-_](?:chart|gauge|progress)\b/i

function vizContainerFor(glyph: HTMLElement, root: HTMLElement): HTMLElement | null {
  for (
    let p = glyph.parentNode as HTMLElement | null;
    p && p !== root;
    p = p.parentNode as HTMLElement | null
  ) {
    if (p.getAttribute("data-viz") != null) return p
    if (p.querySelectorAll("svg").some(isArcGaugeSvg)) return p
    if (GAUGE_CONTAINER_CLASS_RE.test(p.getAttribute("class") ?? "")) return p
  }
  return null
}

/** True when `el` carries no DATA: no numeric leaf, no <img>, no [data-viz],
 * no real gauge svg, and no letters (emoji/symbols do not count). */
function isWhollyDecorative(el: HTMLElement): boolean {
  if (el.querySelector("img")) return false
  if (el.getAttribute("data-viz") != null) return false
  if (el.querySelectorAll("svg").some(isArcGaugeSvg)) return false
  const t = el.text ?? ""
  if (/\p{L}/u.test(t)) return false
  if (DATAVIS_VALUE_RE.test(t.trim())) return false
  return !el
    .querySelectorAll("*")
    .some((n) => n.children.length === 0 && DATAVIS_VALUE_RE.test((n.text ?? "").trim()))
}

/** Widen a glyph removal to the smallest wholly-decorative wrapper (aria-hidden
 * or decoration-classed) below the viz container, so orbiting ring blobs go
 * with the emoji. Falls back to the glyph element itself. */
function decoRemovalTarget(glyph: HTMLElement, container: HTMLElement): HTMLElement {
  let target = glyph
  for (
    let p = glyph.parentNode as HTMLElement | null;
    p && p !== container && isDescendantOf(p, container);
    p = p.parentNode as HTMLElement | null
  ) {
    const ariaHidden = (p.getAttribute("aria-hidden") ?? "") === "true"
    const decoClass = DECO_LAYER_CLASS_RE.test(p.getAttribute("class") ?? "")
    if (!(ariaHidden || decoClass) || !isWhollyDecorative(p)) break
    target = p
  }
  return target
}

const STAT_ICON_SEL = "svg,img,[data-icon],.ic"
const STAT_NUMBER_RE = /^\+?\d{1,4}(?:[.,]\d{1,3})?\s*[%kKmM+]?$/

/** Branch A: a decorative emoji/icon stacked on a datavis number. */
function findGlyphOnMetricDatavis(root: HTMLElement, map: Map<string, string>): HTMLElement[] {
  const out: HTMLElement[] = []
  const candidates: HTMLElement[] = [
    ...root.querySelectorAll("*").filter(isEmojiOnlyElement),
    ...root.querySelectorAll(STAT_ICON_SEL).filter(isCatalogIcon),
  ]
  for (const g of candidates) {
    if (g.closest(METRIC_CHROME_SEL)) continue
    const container = vizContainerFor(g, root)
    if (!container) continue
    if (allowsUpTo(g, "glyph-on-metric", container)) continue
    // The viz must show a number in a DIFFERENT branch than the glyph: that
    // shared-container, different-branch relationship is the stack/overlap.
    const value = container.querySelectorAll("*").find(
      (n) =>
        n.children.length === 0 &&
        n !== g &&
        !isDescendantOf(n, g) &&
        !isDescendantOf(g, n) &&
        DATAVIS_VALUE_RE.test((n.text ?? "").trim()),
    )
    if (!value) continue
    // An emoji is decorative by nature. A catalog icon must be a floated /
    // hidden ornament and not the intentional centered-in-ring glyph.
    if (isCatalogIcon(g)) {
      const decls = elDecls(g, map)
      const floated =
        (g.getAttribute("aria-hidden") ?? "") === "true" ||
        /position\s*:\s*(?:absolute|fixed)/i.test(decls)
      if (!floated || CENTERED_TRANSFORM_RE.test(decls)) continue
    }
    out.push(decoRemovalTarget(g, container))
  }
  return out
}

/** Outermost-leaf elements whose entire trimmed text matches `re`. */
function metricValueEls(scope: HTMLElement, re: RegExp): HTMLElement[] {
  return scope
    .querySelectorAll("*")
    .filter(
      (n) =>
        re.test((n.text ?? "").trim()) &&
        !n.querySelectorAll("*").some((d) => re.test((d.text ?? "").trim())),
    )
}

/** The bounded stat unit around a value: climb while the ancestor stays one
 * small stat, stopping before a 2nd value, page chrome, body, or a big card. */
function statUnitFor(value: HTMLElement, root: HTMLElement): HTMLElement {
  let unit = value
  for (
    let p = value.parentNode as HTMLElement | null;
    p && p !== root;
    p = p.parentNode as HTMLElement | null
  ) {
    if (tagOf(p) === "body" || p.closest(METRIC_CHROME_SEL)) break
    if ((p.text ?? "").replace(/\s+/g, "").length > STAT_UNIT_MAX_CHARS) break
    if (metricValueEls(p, STAT_NUMBER_RE).length >= 2) break
    unit = p
  }
  return unit
}

/** Branch B: every icon/emoji glyph inside a percentage value's stat unit. */
function findGlyphOnMetricPercent(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const value of metricValueEls(root, PERCENT_VALUE_RE)) {
    const unit = statUnitFor(value, root)
    const glyphs: HTMLElement[] = [
      ...unit.querySelectorAll(STAT_ICON_SEL).filter(isCatalogIcon),
      ...unit.querySelectorAll("*").filter(isGlyphLeaf),
    ]
    for (const g of glyphs) {
      if (g === value || isDescendantOf(value, g) || isDescendantOf(g, value)) continue
      if (g.closest(METRIC_CHROME_SEL)) continue
      if (allowsUpTo(g, "glyph-on-metric", unit)) continue
      out.push(g)
    }
  }
  return out
}

/** Remove duplicates and any node whose ancestor is also a target. */
function dedupeRemovalTargets(targets: HTMLElement[]): HTMLElement[] {
  const set = new Set(targets)
  return [...set].filter((el) => {
    for (let p = el.parentNode as HTMLElement | null; p; p = p.parentNode as HTMLElement | null)
      if (set.has(p)) return false
    return true
  })
}

function glyphOnMetricTargets(root: HTMLElement, map: Map<string, string>): HTMLElement[] {
  return dedupeRemovalTargets([
    ...findGlyphOnMetricDatavis(root, map),
    ...findGlyphOnMetricPercent(root),
  ])
}

function glyphKindLabel(el: HTMLElement): string {
  const icon = el.getAttribute("data-icon")
  if (icon) return `icon ${icon}`
  const t = (el.text ?? "").trim()
  if (t && GLYPH_RUN_RE.test(t)) return `glyph "${t}"`
  return `decoration .${(el.getAttribute("class") ?? "?").split(/\s+/)[0]}`
}

function detectGlyphOnMetric(html: string): SlopHit[] {
  return glyphOnMetricTargets(parse(html), collectClassDecls(html)).map((el) => ({
    ruleId: "glyph-on-metric",
    detail: `glyph on a metric (${glyphKindLabel(el)})`,
  }))
}

function fixGlyphOnMetric(html: string): string {
  const root = parse(html)
  const targets = glyphOnMetricTargets(root, collectClassDecls(html))
  if (targets.length === 0) return html
  for (const el of targets) el.remove()
  return root.toString()
}

// ---- stat-label-icon helpers ------------------------------------------------
//
// The number-over-category stat tile whose category label is prefixed with an
// icon: "42 / ALL", "14 / MONUMENTS" with a leading glyph. The label WORD
// already names the category, so the leading icon is duplicate information
// and visual pollution. We strip the redundant leading icon and keep the
// number + word. Tightly scoped so it can't touch icons that carry meaning:
//   - the label's text is a pure category WORD (letters/spaces, no digits/%),
//   - an icon (svg/img/[data-icon]/.ic) LEADS that label,
//   - a numeric value leaf sits in the same small tile (<=24 visible chars)
//     and BEFORE the label in document order, i.e. the big number is the
//     primary read and the category is its caption.
// The document-order guard excludes a menu/nav row with a leading icon and a
// TRAILING count badge, where the icon is the real affordance.
const STAT_LABEL_TAGS = "span,div,p,dt,dd,h3,h4,h5,h6,figcaption,a,button,li"
const STAT_CATEGORY_RE = /^[A-Za-z][A-Za-z &'’/-]{1,19}$/

function findStatLabelIcons(root: HTMLElement): HTMLElement[] {
  // Pre-order document index, so we can require "number before category".
  const order = new Map<HTMLElement, number>()
  let i = 0
  const index = (n: HTMLElement) => {
    order.set(n, i++)
    for (const c of n.childNodes) if ((c as HTMLElement).tagName) index(c as HTMLElement)
  }
  index(root)

  const icons = new Set(root.querySelectorAll(STAT_ICON_SEL))
  const isAncestorOf = (anc: HTMLElement, node: HTMLElement): boolean => {
    for (let p = node.parentNode; p; p = p.parentNode) if (p === anc) return true
    return false
  }

  const leads: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  for (const el of root.querySelectorAll(STAT_LABEL_TAGS)) {
    if (el.closest(METRIC_CHROME_SEL)) continue
    if (elAllows(el, "stat-label-icon")) continue
    if (!STAT_CATEGORY_RE.test(el.text.replace(/\s+/g, " ").trim())) continue
    const lead = el.childNodes.find((c) => (c as HTMLElement).tagName) as
      | HTMLElement
      | undefined
    if (!lead || seen.has(lead)) continue
    const leadIsIcon =
      icons.has(lead) || (!lead.text.trim() && !!lead.querySelector(STAT_ICON_SEL))
    if (!leadIsIcon) continue
    // A numeric value leaf in the same small tile, positioned before the label.
    const elIdx = order.get(el) ?? Infinity
    let found = false
    for (let tile = el.parentNode, hops = 0; tile && hops < 3; tile = tile.parentNode, hops++) {
      if (tile.text.replace(/\s+/g, "").trim().length > 24) continue
      found = tile.querySelectorAll("*").some(
        (n) =>
          n.children.length === 0 &&
          !isAncestorOf(el, n) &&
          n !== el &&
          (order.get(n) ?? Infinity) < elIdx &&
          STAT_NUMBER_RE.test(n.text.trim()),
      )
      if (found) break
    }
    if (!found) continue
    seen.add(lead)
    leads.push(lead)
  }
  return leads
}

// ---- live-clock-eyebrow helpers ---------------------------------------------
//
// The "LIVE 09:41" eyebrow: a live-status dot/badge, optionally trailed by
// the current wall-clock time. Both halves are slop on a device screen: the
// status bar already shows the time, and a "LIVE/NOW" dot is decorative
// chrome. We strip the whole eyebrow. Match ANCHOR is the visible text: the
// element's ENTIRE textContent must be just a LIVE/NOW token, optionally
// followed by a separator + HH:MM. That whole-text equality is what keeps
// this safe: a genuine "LIVE STREAM" heading, a "Departs 09:41" row, or any
// clock time NOT fronted by LIVE/NOW never matches. (Dash separators are
// written as unicode escapes so this source stays dash-free.)
const LIVE_EYEBROW_TEXT = new RegExp(
  "^[\\s\\u2022\\u00B7\\u25CF\\u25CB\\u25C9\\u23FA\\u2B24]*(?:LIVE|NOW)(?:\\s*[\\u00B7\\u2022|/\\u2013\\u2014-]\\s*\\d{1,2}:\\d{2}(?:\\s*[ap]\\.?\\s?m\\.?)?)?[\\s\\u2022\\u00B7]*$",
  "i",
)

// Tags small enough to be an eyebrow/badge; a big wrapper never matches
// because its textContent would carry the surrounding copy too.
const EYEBROW_TAGS = "span,div,p,small,em,strong,b,i,time,label,h6,figcaption"

function findLiveEyebrows(root: HTMLElement): HTMLElement[] {
  const matches = root.querySelectorAll(EYEBROW_TAGS).filter((el) => {
    if (el.closest('[data-brief-role="status-bar"],[data-chrome="status-bar"]')) return false
    if (elAllows(el, "live-clock-eyebrow")) return false
    const text = el.text.replace(/\s+/g, " ").trim()
    if (!text) return false
    return LIVE_EYEBROW_TEXT.test(text)
  })
  // Keep only the OUTERMOST match in any nest (a flagged <div> whose inner
  // <span>LIVE</span> also matches) so the fix removes the badge once,
  // cleanly, instead of leaving a stray "09:41" behind.
  const set = new Set(matches)
  return matches.filter((el) => {
    for (let p = el.parentNode; p; p = p.parentNode) {
      if (set.has(p as HTMLElement)) return false
    }
    return true
  })
}

// ---- floating-hero-card helpers ---------------------------------------------
//
// A small absolutely / fixed-positioned "badge" / "spec" card floated over a
// hero or banner: corner-pinned, backdrop-blurred, carrying only a tiny
// label / value. Decorative chrome that overlaps the artwork and reads as a
// generated-landing signature. We match ONLY a card that is (a)
// position:absolute|fixed, (b) a card surface (border-radius + a fill or a
// backdrop blur), (c) corner-pinned (a vertical AND a horizontal offset, or a
// non-zero inset), (d) short label content with NO heading / link / button /
// form / nav / list / media, and (e) overlaying a section / header that also
// holds a real headline (so the hero's own content column is never removed).
// Outermost matches only; the fix removes them.
const FLOAT_CARD_TAGS = "div,aside,figure,span,article,section"
const FLOAT_HEADLINE_SEL = "h1,h2"
const BADGE_DISQUALIFY_SEL =
  "h1,h2,h3,h4,h5,h6,a[href],button,input,textarea,select,form,nav,ul,ol,img"

function declsPositionedFloat(decls: string): boolean {
  return /position\s*:\s*(?:absolute|fixed)/i.test(decls)
}
// Only true POSITIONING offsets count: `border-top` / `padding-left` must not
// register, so each property is anchored to a declaration boundary.
function declsCornerPinned(decls: string): boolean {
  if (/(?:^|[;{]\s*)inset\s*:\s*[^;]*[1-9]/i.test(decls)) return true
  const vertical = /(?:^|[;{]\s*)(?:top|bottom)\s*:\s*[^;]/i.test(decls)
  const horizontal = /(?:^|[;{]\s*)(?:left|right)\s*:\s*[^;]/i.test(decls)
  return vertical && horizontal
}
function declsFloatingCardSurface(decls: string): boolean {
  const radius = /border-radius\s*:\s*(?:0*[1-9]|var\(|calc\()/i.test(decls)
  const fill =
    /background(?:-color)?\s*:\s*(?!none|transparent|inherit|0\b)[^;]/i.test(decls) ||
    /backdrop-filter\s*:\s*[^;]*blur/i.test(decls) ||
    /(?:^|[;{]\s*)box-shadow\s*:\s*(?!none)[^;]*\d/i.test(decls)
  return radius && fill
}
function isDecorativeBadge(el: HTMLElement): boolean {
  if (el.querySelector(BADGE_DISQUALIFY_SEL)) return false
  const text = el.text.replace(/\s+/g, " ").trim()
  return /[A-Za-z0-9]/.test(text) && text.length <= 90
}
function overlaysHeadline(el: HTMLElement): boolean {
  let depth = 0
  for (let p = el.parentNode; p && depth < 8; p = p.parentNode, depth++) {
    const anc = p as HTMLElement
    const tag = (anc.tagName ?? "").toLowerCase()
    const cls = elClass(anc).toLowerCase()
    const heroish =
      tag === "section" ||
      tag === "header" ||
      /hero|banner|masthead|cover|splash|jumbotron/.test(cls)
    if (!heroish) continue
    for (const h of anc.querySelectorAll(FLOAT_HEADLINE_SEL)) {
      let inEl = false
      for (let q = h.parentNode; q; q = q.parentNode)
        if ((q as HTMLElement) === el) {
          inEl = true
          break
        }
      if (!inEl) return true
    }
  }
  return false
}
function findFloatingHeroCards(root: HTMLElement, map: Map<string, string>): HTMLElement[] {
  const matched = root.querySelectorAll(FLOAT_CARD_TAGS).filter((el) => {
    if (elAllows(el, "floating-hero-card")) return false
    const decls = elDecls(el, map)
    return (
      declsPositionedFloat(decls) &&
      declsCornerPinned(decls) &&
      declsFloatingCardSurface(decls) &&
      isDecorativeBadge(el) &&
      overlaysHeadline(el)
    )
  })
  const set = new Set(matched)
  return matched.filter((el) => {
    for (let p = el.parentNode; p; p = p.parentNode) if (set.has(p as HTMLElement)) return false
    return true
  })
}

// ---- grid-spacer-void helpers ------------------------------------------------
//
// A full-span hairline (`grid-column: 1 / -1; height: 1px`) used as a row
// divider, placed as a child of a grid whose IMPLICIT rows are a fixed height
// (`grid-auto-rows: 168px`), lands in its OWN 168px track: the 1px line draws
// at the top and ~167px of empty page shows below it. Switching that grid's
// grid-auto-rows to `auto` collapses the divider's row to its 1px content
// while the real cells size to their content, and the divider lines survive:
// the void is the only thing removed.

/** A fixed-tall implicit row height is a void risk only when noticeably
 * taller than a hairline; below this a fixed auto-row is gap-like, not a row. */
const MIN_TALL_AUTO_ROW_PX = 24
/** A divider/separator child this short cannot fill a tall auto-row track. */
const MAX_SEPARATOR_HEIGHT_PX = 12

/** The single fixed px value of `grid-auto-rows`, or null (auto / fr / minmax /
 * multi-track: none of which strands a thin child in a tall track). */
function fixedAutoRowPx(decls: string): number | null {
  const m = decls.match(/grid-auto-rows\s*:\s*([^;}]+)/i)
  if (!m) return null
  const px = m[1].trim().match(/^(\d+(?:\.\d+)?)px$/)
  return px ? parseFloat(px[1]) : null
}

/** A grid child that spans every column and is only a hairline tall: a row
 * divider that will be inflated to a whole implicit-row track. */
function isThinFullSpanSeparator(decls: string): boolean {
  if (!/grid-column\s*:\s*1\s*\/\s*-1\b/i.test(decls)) return false
  const hm = decls.match(/(?:^|[;{\s])height\s*:\s*(\d+(?:\.\d+)?)px/i)
  return hm != null && parseFloat(hm[1]) <= MAX_SEPARATOR_HEIGHT_PX
}

/**
 * Class names whose rule declares a fixed `grid-auto-rows` on a grid that
 * actually contains a thin full-span separator descendant. These are the
 * grids whose auto-rows we neutralize; an unrelated fixed-row gallery (no
 * separator child) is left untouched.
 */
function gridSpacerVoidClasses(html: string): Set<string> {
  const out = new Set<string>()
  let root: HTMLElement
  try {
    root = parse(html)
  } catch {
    return out
  }
  const map = collectClassDecls(html)
  const all = root.querySelectorAll("*")
  const seps = all.filter((el) => isThinFullSpanSeparator(elDecls(el, map)))
  if (seps.length === 0) return out
  for (const el of all) {
    const decls = elDecls(el, map)
    if (declsAllow(decls, "grid-spacer-void")) continue
    const px = fixedAutoRowPx(decls)
    if (px === null || px < MIN_TALL_AUTO_ROW_PX) continue
    if (!seps.some((s) => isDescendantOf(s, el))) continue
    // Pin the fix to whichever of this grid's classes actually carries the
    // fixed grid-auto-rows (so the CSS rewrite targets the right rule).
    for (const c of elClass(el).split(/\s+/).filter(Boolean)) {
      const cd = map.get(c)
      if (cd && fixedAutoRowPx(cd) !== null) out.add(c)
    }
  }
  return out
}

function fixGridSpacerVoid(html: string): string {
  const classes = gridSpacerVoidClasses(html)
  if (classes.size === 0) return html
  return html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css: string) => {
    const clean = stripCssComments(css)
    const fixed = clean.replace(
      /([^{}]+)\{([^{}]*)\}/g,
      (rule: string, sel: string, body: string) => {
        const selClasses = [...sel.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1])
        if (!selClasses.some((c) => classes.has(c)) || fixedAutoRowPx(body) === null) return rule
        const next = body.replace(/grid-auto-rows\s*:\s*[^;}]+/i, "grid-auto-rows: auto")
        return next === body ? rule : `${sel}{${next}}`
      },
    )
    return fixed === clean ? full : full.replace(css, () => fixed)
  })
}

// ---- inline-padding helpers (wrap-padding-collision / hscroll-snap-gutter) --

const ZERO_LEN_RE = /^0(?:px|rem|em|%|vw|vh)?$/i

/**
 * The resolved inline (left / right) padding of a declaration block, or null
 * when there is no non-zero inline padding (so a fix abstains rather than
 * guessing). Handles `padding` (1-4 values), `padding-inline` (1-2),
 * `padding-left/right`, and logical `padding-inline-start/end`, honoring CSS
 * source order so a later longhand overrides an earlier shorthand.
 */
function inlinePaddingOf(decls: string): { start: string; end: string } | null {
  let start: string | null = null
  let end: string | null = null
  for (const raw of splitTopLevel(decls, ";")) {
    const idx = raw.indexOf(":")
    if (idx < 0) continue
    const prop = raw.slice(0, idx).trim().toLowerCase()
    const val = raw
      .slice(idx + 1)
      .replace(/!important/i, "")
      .trim()
    if (!val) continue
    if (prop === "padding") {
      const p = splitTopLevel(val, " ").map((s) => s.trim()).filter(Boolean)
      if (p.length === 1) [start, end] = [p[0], p[0]]
      else if (p.length === 2 || p.length === 3) [start, end] = [p[1], p[1]]
      else if (p.length === 4) [start, end] = [p[3], p[1]]
    } else if (prop === "padding-inline") {
      const p = splitTopLevel(val, " ").map((s) => s.trim()).filter(Boolean)
      if (p.length === 1) [start, end] = [p[0], p[0]]
      else if (p.length >= 2) [start, end] = [p[0], p[1]]
    } else if (prop === "padding-left" || prop === "padding-inline-start") {
      start = val
    } else if (prop === "padding-right" || prop === "padding-inline-end") {
      end = val
    }
  }
  if ((start == null || ZERO_LEN_RE.test(start)) && (end == null || ZERO_LEN_RE.test(end))) {
    return null
  }
  return { start: start ?? "0", end: end ?? "0" }
}

// ---- wrap-padding-collision helpers -----------------------------------------
//
// A section that carries the page's inset / `.wrap` container class (centered:
// margin-inline:auto, with a non-zero padding-inline) but ALSO zeroes its OWN
// horizontal padding, usually a vertical-only `padding: <v> 0` shorthand whose
// sides silently collapse to 0. At equal specificity the later rule wins, so
// the container's padding-inline is clobbered and the band runs flush to the
// screen edge. The fix strips the horizontal zeros from the offending class's
// rule (a `padding: V 0` becomes `padding-block: V`), so the container's inset
// survives while the vertical rhythm is preserved.

/** True when a rule centers its element horizontally (margin-inline:auto, the
 *  margin shorthand with auto, or symmetric margin-left/right:auto). */
function centersHorizontally(decls: string): boolean {
  return (
    /margin-inline\s*:\s*auto/i.test(decls) ||
    (/margin-inline-start\s*:\s*auto/i.test(decls) &&
      /margin-inline-end\s*:\s*auto/i.test(decls)) ||
    (/margin-left\s*:\s*auto/i.test(decls) && /margin-right\s*:\s*auto/i.test(decls)) ||
    /(?:^|[;{\s])margin\s*:\s*[^;}]*\bauto\b/i.test(decls)
  )
}

/** True when the declarations set a horizontal/inline padding at all (the
 *  `padding` shorthand, `padding-inline*`, or `padding-left/right`), NOT just
 *  `padding-top/bottom/block`. */
function declaresInlinePadding(decls: string): boolean {
  return /(?:^|[;{\s])padding(?:-inline(?:-start|-end)?|-left|-right)?\s*:/i.test(decls)
}

/** A rule body that explicitly zeroes its horizontal padding: it declares an
 *  inline padding, yet `inlinePaddingOf` resolves to no non-zero inset. This
 *  is the override that clobbers a container's padding-inline. */
function isInlineZeroPaddingBody(decls: string): boolean {
  return declaresInlinePadding(decls) && inlinePaddingOf(decls) === null
}

/**
 * Classes that zero their horizontal padding while co-applied (same element)
 * with an inset container class. The inset container is detected by signature
 * (centered + a non-zero padding-inline), never by a hardcoded name, so it
 * holds whatever the author called their wrapper.
 */
function wrapPaddingCollisionClasses(html: string): Set<string> {
  const out = new Set<string>()
  const map = collectClassDecls(html)
  const containers = new Set<string>()
  for (const [cls, decls] of map) {
    if (centersHorizontally(decls) && inlinePaddingOf(decls) !== null) containers.add(cls)
  }
  if (containers.size === 0) return out
  let root: HTMLElement
  try {
    root = parse(html)
  } catch {
    return out
  }
  for (const el of root.querySelectorAll("*")) {
    const classes = elClass(el).split(/\s+/).filter(Boolean)
    if (!classes.some((c) => containers.has(c))) continue
    for (const c of classes) {
      if (containers.has(c)) continue
      const d = map.get(c)
      if (d && isInlineZeroPaddingBody(d) && !declsAllow(d, "wrap-padding-collision")) out.add(c)
    }
  }
  return out
}

/** Drop the horizontal-zero padding from a rule body, preserving vertical
 *  padding (`padding: V 0` becomes `padding-block: V`) so the container's
 *  padding-inline can apply. */
function stripHorizontalPadding(body: string): string {
  const out: string[] = []
  for (const raw of splitTopLevel(body, ";")) {
    const d = raw.trim()
    if (!d) continue
    const idx = d.indexOf(":")
    if (idx < 0) {
      out.push(d)
      continue
    }
    const prop = d.slice(0, idx).trim().toLowerCase()
    const val = d.slice(idx + 1).trim()
    if (
      prop === "padding-left" ||
      prop === "padding-right" ||
      prop === "padding-inline" ||
      prop === "padding-inline-start" ||
      prop === "padding-inline-end"
    ) {
      continue // drop horizontal / inline-logical padding; the container supplies it
    }
    if (prop === "padding") {
      const p = splitTopLevel(val, " ")
        .map((s) => s.trim())
        .filter(Boolean)
      if (p.length <= 1) continue // 1-value all-zero shorthand: drop entirely
      if (p.length === 2) {
        out.push(`padding-block: ${p[0]}`) // V H: keep vertical only
        continue
      }
      out.push(`padding-top: ${p[0]}`) // 3/4-value: keep top/bottom
      out.push(`padding-bottom: ${p[2] ?? p[0]}`)
      continue
    }
    out.push(d)
  }
  return out.join("; ")
}

function fixWrapPaddingCollision(html: string): string {
  const classes = wrapPaddingCollisionClasses(html)
  if (classes.size === 0) return html
  return html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css: string) => {
    const clean = stripCssComments(css)
    const fixed = clean.replace(
      /([^{}]+)\{([^{}]*)\}/g,
      (rule: string, sel: string, body: string) => {
        const selClasses = [...sel.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1])
        if (!selClasses.some((c) => classes.has(c)) || !isInlineZeroPaddingBody(body)) return rule
        const next = stripHorizontalPadding(body)
        return next === body ? rule : `${sel}{${next}}`
      },
    )
    return fixed === clean ? full : full.replace(css, () => fixed)
  })
}

// ---- body-display-contents helpers -------------------------------------------
//
// display:contents on <body> makes it generate no box: its padding, width,
// and flex gap are ALL discarded, so the screen renders with no side padding
// and zero section rhythm. Scoped STRICTLY to body: display:contents is
// legitimate on wrapper divs.

const DISPLAY_CONTENTS_DECL = /display\s*:\s*contents\s*;?/gi

// `body{`, `body {`, or `body` in a selector LIST (`html, body {`,
// `body, .x {`). Deliberately does NOT match descendant selectors
// (`body .child {`), where display:contents targets a child, not body.
const BODY_RULE = /((?:^|[\s>{},;])body\s*(?:,[^{]*)?\{)([^}]*)(\})/gi

/** display:contents declarations applied to BODY: inline styles on any
 *  <body> open tag (duplicates included) plus any `body{}` CSS rule. */
function bodyDisplayContentsCount(html: string): number {
  let count = 0
  for (const m of html.matchAll(/<body\b[^>]*\bstyle\s*=\s*["']([^"']*)["']/gi)) {
    if (/display\s*:\s*contents/i.test(m[1]) && !declsAllow(m[1], "body-display-contents"))
      count++
  }
  for (const m of html.matchAll(BODY_RULE)) {
    if (/display\s*:\s*contents/i.test(m[2]) && !declsAllow(m[2], "body-display-contents"))
      count++
  }
  return count
}

/** Strip the display:contents declaration from body inline styles and
 *  `body{}` rules only; every other declaration is left intact. */
function stripBodyDisplayContents(html: string): string {
  return html
    .replace(
      /(<body\b[^>]*\bstyle\s*=\s*["'])([^"']*)(["'])/gi,
      (_m, pre: string, style: string, post: string) =>
        /display\s*:\s*contents/i.test(style) && !declsAllow(style, "body-display-contents")
          ? pre + style.replace(DISPLAY_CONTENTS_DECL, "").trim() + post
          : pre + style + post,
    )
    .replace(BODY_RULE, (_m, pre: string, decls: string, post: string) =>
      /display\s*:\s*contents/i.test(decls) && !declsAllow(decls, "body-display-contents")
        ? pre + decls.replace(DISPLAY_CONTENTS_DECL, "") + post
        : pre + decls + post,
    )
}

// ---- hscroll-snap-gutter helpers ---------------------------------------------
//
// A horizontal scroll-snap carousel whose side gutter is the container's OWN
// inline padding loses that gutter when the browser force-snaps the first
// card flush to the edge: the snapport is the scrollport minus scroll-padding
// (default 0), so scroll-snap-align:start under mandatory snap rests
// scrollLeft past the leading padding. The fix mirrors the inline padding
// into scroll-padding-inline so the cards snap inside the gutter. It is
// additive (base tier): a screen without it is not "slop", so it never feeds
// severity, but it is auto-fixed on every fix pass.

/** A horizontally-scrolling, inline-axis snap container (the at-risk shape). */
function isHScrollSnapContainer(decls: string): boolean {
  const horizScroll = /(?:^|[\s;{])overflow(?:-x)?\s*:\s*(?:auto|scroll)/i.test(decls)
  const inlineSnap = /(?:^|[\s;{])scroll-snap-type\s*:\s*[^;}"']*\b(?:x|inline|both)\b/i.test(decls)
  return horizScroll && inlineSnap
}

/** True once any scroll-padding longhand/shorthand is present (idempotency). */
function hasScrollPadding(decls: string): boolean {
  return /(?:^|[\s;{])scroll-padding(?:-inline|-block|-top|-bottom|-left|-right|-inline-start|-inline-end|-block-start|-block-end)?\s*:/i.test(
    decls,
  )
}

/** A snap carousel that insets its cards with padding but sets no scroll-padding. */
function isLeakyHScrollSnapGroup(decls: string): boolean {
  if (declsAllow(decls, "hscroll-snap-gutter")) return false
  return (
    isHScrollSnapContainer(decls) && !hasScrollPadding(decls) && inlinePaddingOf(decls) !== null
  )
}

/** Count leaky snap carousels across <style> rule groups + inline styles. */
function countLeakyHScrollSnap(html: string): number {
  let n = 0
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const clean = stripCssComments(block[1])
    for (const m of clean.matchAll(/[^{}]+\{([^{}]*)\}/g)) {
      if (isLeakyHScrollSnapGroup(m[1])) n++
    }
  }
  for (const inline of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
    if (isLeakyHScrollSnapGroup(inline[1])) n++
  }
  return n
}

/** Append scroll-padding-inline matching the inline gutter. Idempotent + abstaining. */
function addScrollPaddingInline(decls: string): string {
  if (hasScrollPadding(decls)) return decls
  const pad = inlinePaddingOf(decls)
  if (!pad) return decls
  const value = pad.start === pad.end ? pad.start : `${pad.start} ${pad.end}`
  const trimmed = decls.replace(/\s+$/, "")
  const sep = trimmed === "" || trimmed.endsWith(";") ? "" : ";"
  return `${trimmed}${sep}scroll-padding-inline:${value}`
}

// ---- base-polish helpers (text-wrap-orphans / font-smoothing) -----------------
//
// Base-tier rules INJECT a marked base-CSS block once (idempotent on the
// marker id). Their absence is not a defect, so they never count toward
// pass/severity; only `fix` applies them. To opt a document out entirely,
// ship your own (even empty) <style> with the same id.

/** True when a `<style id="...">` polish block is already present (idempotency). */
function hasPolishBlock(html: string, id: string): boolean {
  return new RegExp(`<style[^>]*\\bid=["']${id}["']`, "i").test(html)
}

/**
 * True for a full page (has <html>/<body>/</head>), false for a bare fragment.
 * Base-style injection only targets real pages so it never mutates a snippet.
 */
function isFullDocument(html: string): boolean {
  return /<html\b|<body\b|<\/head>/i.test(html)
}

/**
 * Inject a polish `<style id>` block once. Idempotent on the id. Prefers
 * </head>; falls back to just after <body ...>, else prepends.
 */
function injectPolishBlock(html: string, id: string, css: string): string {
  if (hasPolishBlock(html, id)) return html
  const tag = `<style id="${id}">${css}</style>`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}\n</head>`)
  const body = html.match(/<body\b[^>]*>/i)
  if (body) return html.replace(body[0], `${body[0]}${tag}`)
  return tag + html
}

// ---------------------------------------------------------------------------
// Masthead helpers (VOL / ISSUE / № print-chrome artifacts). Ported from the
// production registry in 0.4.0.
// ---------------------------------------------------------------------------

// The element's WHOLE textContent must be a vol/issue/serial reference, so a
// sentence that merely contains "issue" never matches. Safeguards: (a) a
// VOL/ISSUE/EDITION/SERIAL KEYWORD is REQUIRED (a bare "№ 1" rank badge is
// spared); (b) abbreviations (VOL/NO) require the trailing dot, keeping "NO 1"
// answers safe; (c) HEADINGS (h1-h6) are NOT eligible, so a real section
// heading like "VOL. 04" is never deleted.
const MASTHEAD_TAGS = "span,small,em,strong,b,i,time,label,figcaption,p,div"
const MASTHEAD_EYEBROW_TEXT =
  /^[\s•·●○—–|/]*(?:(?:issue|edition|serial)\s*[№#]?\s*\d{1,4}|(?:vol|no)\.\s*[№#]?\s*\d{1,4})(?:\s*[•·—–|/]+\s*(?:№\s*)?\d{1,4})*[\s•·]*$/i

function findEyebrowMatches(root: HTMLElement, re: RegExp): HTMLElement[] {
  const matches = root.querySelectorAll(MASTHEAD_TAGS).filter((el) => {
    const text = el.text.replace(/\s+/g, " ").trim()
    return !!text && re.test(text)
  })
  const set = new Set(matches)
  return matches.filter((el) => {
    for (let p = el.parentNode; p; p = p.parentNode)
      if (set.has(p as HTMLElement)) return false
    return true
  })
}

// The BLOCK cousin: a CLUSTER of fake print-publication metadata (VOLUME /
// CATALOGUE / EDITION labels + invented numbers + a serial code). Fires only
// on >=1 periodical label family AND >=2 total tells (families + serial), in a
// TERSE (<=140 char) container with no real content/heading/media and not
// inside <footer>/<nav>, so real footers, changelogs, and spec tables are
// spared. A single family REPEATED ("Volume 1 / Volume 2") never fires.
const MASTHEAD_LABEL_FAMILIES: RegExp[] = [
  /\bvol(?:ume)?\.?\s*[№#]?\s*\d{1,4}\b/i,
  /\bissue\.?\s*[№#]?\s*\d{1,4}\b/i,
  /\bedition\.?\s*[№#]?\s*\d{1,4}\b/i,
  /\bcatal(?:ogue|og)\.?\s*[№#]?\s*\d{1,4}\b/i,
  /\bfolio\.?\s*[№#]?\s*\d{1,4}\b/i,
  /№\s*\d{1,4}\b/,
]
// A fabricated serial code: HV-IDX-029 (>=2 dash-joined groups). Dash class =
// ASCII hyphen + U+2010..U+2015.
const MASTHEAD_SERIAL_RE = /\b[A-Z]{2,}[‐-―-][A-Z0-9]{2,}(?:[‐-―-][A-Z0-9]+)+\b/g
const MASTHEAD_BLOCK_TAGS = "div,header,aside,dl,section,table"
const MASTHEAD_BLOCK_DISQUALIFY =
  "h1,h2,h3,h4,h5,h6,a,button,input,textarea,select,form,nav,img,svg,picture,video"

function mastheadInChromeLandmark(el: HTMLElement): boolean {
  for (
    let p = el.parentNode as HTMLElement | null;
    p;
    p = p.parentNode as HTMLElement | null
  ) {
    const tag = (p.tagName ?? "").toLowerCase()
    if (tag === "footer" || tag === "nav") return true
  }
  return false
}

function isPublicationMastheadBlock(el: HTMLElement): boolean {
  // el.text concatenates child text with NO separator; replace tags with
  // spaces so sibling labels/values stay word-separated.
  const text = el.innerHTML
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text || text.length > 140) return false
  if (el.querySelector(MASTHEAD_BLOCK_DISQUALIFY)) return false
  if (mastheadInChromeLandmark(el)) return false
  const distinctFamilies = MASTHEAD_LABEL_FAMILIES.reduce(
    (n, re) => n + (re.test(text) ? 1 : 0),
    0,
  )
  if (distinctFamilies < 1) return false
  const hasSerial = (text.match(MASTHEAD_SERIAL_RE)?.length ?? 0) > 0
  return distinctFamilies + (hasSerial ? 1 : 0) >= 2
}

function findPublicationMastheadBlocks(root: HTMLElement): HTMLElement[] {
  const matched = root.querySelectorAll(MASTHEAD_BLOCK_TAGS).filter(isPublicationMastheadBlock)
  const set = new Set(matched)
  // Outermost match only (remove the container, not its inner rows).
  return matched.filter((el) => {
    for (let p = el.parentNode; p; p = p.parentNode) if (set.has(p as HTMLElement)) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Selector-aware CSS walkers (edge-stripe + redundant-border). Unlike
// rewriteCssGroups these walk SELECTORS too, so state carve-outs can apply.
// ---------------------------------------------------------------------------

const STYLE_RULE_RE = /([^{}]+)\{([^{}]*)\}/g
const INLINE_STYLE_TAG_RE = /(<[a-z][a-z0-9-]*\b[^>]*\sstyle\s*=\s*")([^"]*)("[^>]*>)/gi

// A single selected/current row taking one 3-4px leading accent border is a
// legal interactive-state treatment; only decorative/repeated rails are slop.
const EDGE_STATE_SELECTOR_RE =
  /\[aria-(?:selected|current)\b|:checked|\.(?:active|selected|current|is-selected|is-active)\b/i
const EDGE_STATE_TAG_RE =
  /\baria-(?:selected|current)\s*=\s*"(?:true|page|step|location|date|time)"|\bclass\s*=\s*"[^"]*\b(?:active|selected|current|is-selected|is-active)\b/i

function groupHasEdgeStripe(decls: string): boolean {
  const re = /border-(?:left|right)(?:-width)?\s*:\s*([^;]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(decls)) !== null) {
    const val = m[1]
    const w = val.match(/(\d+(?:\.\d+)?)px/)
    if (w && parseFloat(w[1]) >= 3 && !/\b(?:none|transparent)\b/i.test(val)) return true
  }
  return false
}
function stripEdgeStripe(decls: string): string {
  return decls
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !/^border-(?:left|right)(?:-width|-color|-style)?\s*:/i.test(d))
    .join("; ")
}

function countEdgeStripes(html: string): number {
  let n = 0
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of block[1].matchAll(STYLE_RULE_RE)) {
      if (declsAllow(rule[2], "edge-stripe")) continue
      if (!EDGE_STATE_SELECTOR_RE.test(rule[1]) && groupHasEdgeStripe(rule[2])) n++
    }
  }
  for (const tag of html.matchAll(INLINE_STYLE_TAG_RE)) {
    if (tagAllows(tag[0], "edge-stripe") || declsAllow(tag[2], "edge-stripe")) continue
    if (!EDGE_STATE_TAG_RE.test(tag[0]) && groupHasEdgeStripe(tag[2])) n++
  }
  return n
}

function fixEdgeStripes(html: string): string {
  let out = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css: string) => {
    const fixed = css.replace(STYLE_RULE_RE, (rule: string, sel: string, body: string) =>
      !EDGE_STATE_SELECTOR_RE.test(sel) &&
      !declsAllow(body, "edge-stripe") &&
      groupHasEdgeStripe(body)
        ? `${sel}{${stripEdgeStripe(body)}}`
        : rule,
    )
    return fixed === css ? full : full.replace(css, () => fixed)
  })
  out = out.replace(INLINE_STYLE_TAG_RE, (full, pre: string, val: string, post: string) =>
    !EDGE_STATE_TAG_RE.test(full) &&
    !tagAllows(full, "edge-stripe") &&
    !declsAllow(val, "edge-stripe") &&
    groupHasEdgeStripe(val)
      ? `${pre}${stripEdgeStripe(val)}${post}`
      : full,
  )
  return out
}

// A border is functional (NOT redundant chrome) on interactive controls +
// their states, form fields, table grid cells, code/keycap surfaces, and
// callouts. Those selectors/tags are never stripped.
const BORDER_CONTROL_SELECTOR_RE =
  /(?:^|[\s,>+~])(?:button|input|select|textarea|td|th|table|pre|code|kbd|samp)\b|\[type\s*=|\[role\s*=\s*["'](?:alert|status|searchbox|textbox)["']|\.(?:btn|button|input|field|chip|tab|segment|toggle|switch|search|search-field|searchbox|textfield|alert|callout|banner|notice)\b|:hover|:active|:focus(?:-visible)?|:disabled/i
const BORDER_CONTROL_TAG_RE =
  /[\s"']type\s*=|[\s"']role\s*=\s*["'](?:alert|status|searchbox|textbox)["']|^<(?:button|input|select|textarea|td|th|table|pre|code|kbd|samp)\b/i

function hasRealFill(decls: string): boolean {
  const m = decls.match(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;}]+)/i)
  if (!m) return false
  const v = m[1].trim().toLowerCase()
  return !/^(?:none|transparent|inherit|initial|unset|currentcolor)$/.test(v)
}

/** Alpha of a border color value, or null when not explicitly transparent
 * (named / hex6 / a plain var: treat as opaque, i.e. unknown). */
function borderColorAlpha(v: string): number | null {
  const fn = v.match(/(?:rgba?|hsla?)\(([^)]*)\)/i)
  if (fn) {
    const inner = fn[1].trim()
    const slash = inner.split("/")
    if (slash.length === 2) return parseAlpha(slash[1])
    const parts = inner.split(",").map((s) => s.trim()).filter(Boolean)
    return parts.length >= 4 ? parseAlpha(parts[3]) : 1
  }
  const hex8 = v.match(/#[0-9a-f]{8}\b/i)
  if (hex8) return parseInt(hex8[0].slice(7, 9), 16) / 255
  return null
}

function hasVisibleBorder(decls: string): boolean {
  const re = /(?:^|[;{\s])border(?:-(?:top|right|bottom|left))?\s*:\s*([^;}]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(decls)) !== null) {
    const v = m[1]
    if (/\b(?:none|hidden)\b/i.test(v) || /\btransparent\b/i.test(v)) continue
    // A deliberate hairline (low-alpha color or a divider/hairline/stroke
    // token) is NOT a boxy redundant border. Only flag opaque boxes.
    if (/var\(\s*--[\w-]*(?:divider|hairline|stroke|line)/i.test(v)) continue
    const alpha = borderColorAlpha(v)
    if (alpha !== null && alpha <= 0.1) continue
    const w = v.match(/(\d*\.?\d+)\s*px/)
    if (w) {
      if (parseFloat(w[1]) >= 1) return true
    } else if (/\b(?:solid|dashed|dotted|double)\b/i.test(v)) {
      return true // no explicit width: CSS default `medium` (~3px), visible
    }
  }
  return false
}

function groupHasRedundantBorder(decls: string): boolean {
  return hasRealFill(decls) && hasVisibleBorder(decls)
}

/** Drop border / border-<side|width|style|color|block|inline>; KEEP border-radius. */
function stripBorderDecls(decls: string): string {
  return stripCssComments(decls)
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter(
      (d) =>
        !/^border(?:-(?:top|right|bottom|left|width|style|color|block|inline))?\s*:/i.test(d),
    )
    .join("; ")
}

const borderSkipSelector = (sel: string): boolean =>
  EDGE_STATE_SELECTOR_RE.test(sel) || BORDER_CONTROL_SELECTOR_RE.test(sel)
const borderSkipTag = (tag: string): boolean =>
  EDGE_STATE_TAG_RE.test(tag) || BORDER_CONTROL_TAG_RE.test(tag)

function countRedundantBorders(html: string): number {
  let n = 0
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of stripCssComments(block[1]).matchAll(STYLE_RULE_RE)) {
      if (declsAllow(rule[2], "redundant-border")) continue
      if (!borderSkipSelector(rule[1]) && groupHasRedundantBorder(rule[2])) n++
    }
  }
  for (const tag of html.matchAll(INLINE_STYLE_TAG_RE)) {
    if (tagAllows(tag[0], "redundant-border") || declsAllow(tag[2], "redundant-border")) continue
    if (!borderSkipTag(tag[0]) && groupHasRedundantBorder(tag[2])) n++
  }
  return n
}

function fixRedundantBorders(html: string): string {
  let out = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css: string) => {
    const clean = stripCssComments(css)
    const fixed = clean.replace(STYLE_RULE_RE, (rule: string, sel: string, body: string) =>
      !borderSkipSelector(sel) &&
      !declsAllow(body, "redundant-border") &&
      groupHasRedundantBorder(body)
        ? `${sel}{${stripBorderDecls(body)}}`
        : rule,
    )
    return fixed === clean ? full : full.replace(css, () => fixed)
  })
  out = out.replace(INLINE_STYLE_TAG_RE, (full, pre: string, val: string, post: string) =>
    !borderSkipTag(full) &&
    !tagAllows(full, "redundant-border") &&
    !declsAllow(val, "redundant-border") &&
    groupHasRedundantBorder(val)
      ? `${pre}${stripBorderDecls(val)}${post}`
      : full,
  )
  return out
}

// ---------------------------------------------------------------------------
// Over-designed list-row family. Structural tells (a regex can't safely
// re-lay-out a row), so these are FLAG-tier in the public pack: on app feed
// screens they are real defects, but on a marketing page a testimonial or
// feature-card grid is the genre, and a portable detector cannot see genre.
// Treat their hits as must-fix on app UI, judgment calls on landings.
// ---------------------------------------------------------------------------

/** Element children only (skips text / comment nodes). */
function elementChildren(el: HTMLElement): HTMLElement[] {
  return (el.childNodes as unknown as Array<{ nodeType?: number }>).filter(
    (c) => c.nodeType === 1,
  ) as unknown as HTMLElement[]
}

/** Visible text runs (direct text nodes, in document order); letters/digits only. */
function textRuns(el: HTMLElement): string[] {
  const out: string[] = []
  const walk = (n: HTMLElement) => {
    for (const c of n.childNodes as unknown as Array<{ nodeType?: number; rawText?: string }>) {
      if (c.nodeType === 1) walk(c as unknown as HTMLElement)
      else if (c.nodeType === 3) {
        const t = String(c.rawText ?? "")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim()
        if (/[A-Za-z0-9]{2,}/.test(t)) out.push(t)
      }
    }
  }
  walk(el)
  return out
}

// An affordance glyph, not a thumbnail: icon-marked, icon-classed (the common
// icon-set class names in the wild), or a small fixed-canvas svg (<=32).
const ROW_ICON_CLASS_RE =
  /\b(?:ic|icon|lucide|feather|tabler|heroicons?|material-icons?|fa|bi)\b/i
function svgCanvasSize(el: HTMLElement): number | null {
  const vb = (el.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/)
  const fromVb = parseFloat(vb[2] ?? "")
  if (Number.isFinite(fromVb) && fromVb > 0) return fromVb
  const w = parseFloat(el.getAttribute("width") ?? "")
  return Number.isFinite(w) && w > 0 ? w : null
}

/** Thumbnails / photos in a row: <img> or a sizeable non-icon <svg>. */
function rowMediaCount(row: HTMLElement): number {
  return row.querySelectorAll("img,svg").filter((m) => {
    const tag = (m.tagName ?? "").toLowerCase()
    if (tag === "img") return true
    if (m.getAttribute("data-icon") != null) return false
    if (ROW_ICON_CLASS_RE.test(elClass(m))) return false
    const size = svgCanvasSize(m)
    if (size !== null && size <= 32) return false
    return true
  }).length
}

/**
 * Groups of >=min sibling elements that read as repeating rows / cards: same
 * tag + leading class under one parent, each carrying real text. Conservative:
 * used only to require that a tell REPEATS before any row rule fires.
 */
function repeatingRowSets(root: HTMLElement, min = 2): HTMLElement[][] {
  const sets: HTMLElement[][] = []
  const walk = (node: HTMLElement) => {
    const kids = elementChildren(node)
    const byKey = new Map<string, HTMLElement[]>()
    for (const k of kids) {
      const lead = elClass(k).split(/\s+/)[0] ?? ""
      const key = `${k.tagName}.${lead}`
      const arr = byKey.get(key) ?? []
      arr.push(k)
      byKey.set(key, arr)
    }
    for (const arr of byKey.values()) {
      const rows = arr.filter((r) => r.text.replace(/\s+/g, " ").trim().length >= 8)
      if (rows.length >= min) sets.push(rows)
    }
    for (const k of kids) walk(k)
  }
  walk(root)
  return sets
}

const UPPER_KICKER_RE = /^[A-Z0-9][A-Z0-9 ·•|/&'’.-]{2,42}$/
/** A short ALL-CAPS multi-token kicker ("LOCAL FAVORITE · 96 RAVING"). */
function isUpperKicker(text: string): boolean {
  if (!UPPER_KICKER_RE.test(text)) return false
  if (!/[A-Z]/.test(text)) return false
  if (text !== text.toUpperCase()) return false
  // multi-token (a separator or interior space); excludes a one-word label.
  return /[·•|]/.test(text) || /\S\s+\S/.test(text)
}

function rowHasKickerAboveTitle(row: HTMLElement): boolean {
  const runs = textRuns(row)
  if (runs.length < 2) return false
  const ki = runs.findIndex(isUpperKicker)
  if (ki === -1) return false
  return runs.slice(ki + 1).some((r) => /[a-z]/.test(r) && r.length >= 8)
}

const QUOTE_START_RE = /^(?:&ldquo;|&quot;|&#822[01];|["“])/
function rowHasMultilineMeta(row: HTMLElement): boolean {
  for (const c of row.querySelectorAll("*")) {
    if (c.querySelectorAll("*").length > 0) continue // leaf-ish only
    if (QUOTE_START_RE.test((c.innerHTML ?? "").trim())) return true
  }
  for (const br of row.querySelectorAll("br")) {
    const host = br.parentNode as HTMLElement | null
    const tag = (host?.tagName ?? "").toLowerCase()
    if (!/^h[1-6]$/.test(tag)) return true // a <br> outside a heading = a wrapped meta line
  }
  return false
}

const OVERSTUFFED_SLOT_CAP = 4 // > this = overstuffed; 3 info slots is the row budget
function rowInfoSlots(row: HTMLElement): number {
  return textRuns(row).length + rowMediaCount(row)
}

function declsHaveCardSurface(decls: string): boolean {
  const radius = /border-radius\s*:\s*(?:0*[1-9]|var\(|calc\()/i.test(decls)
  const fill =
    /background(?:-color)?\s*:\s*(?!none|transparent|inherit|0\b)[^;]/i.test(decls) ||
    /\bbox-shadow\s*:\s*(?!none)/i.test(decls)
  const border = /\bborder(?:-top|-right|-bottom|-left)?\s*:\s*[^;]*\d/i.test(decls)
  return radius && (fill || border)
}
function findRowCards(root: HTMLElement, classMap: Map<string, string>): HTMLElement[][] {
  const out: HTMLElement[][] = []
  for (const rows of repeatingRowSets(root, 3)) {
    const carded = rows.filter(
      (r) =>
        rowMediaCount(r) >= 1 &&
        textRuns(r).length >= 2 &&
        declsHaveCardSurface(elDecls(r, classMap)),
    )
    if (carded.length >= 3) out.push(carded)
  }
  return out
}

// ---------------------------------------------------------------------------
// Headline-consistency helpers (multicolor-heading + mixed-style-headline).
// ---------------------------------------------------------------------------

const MC_HEADING_SEL = "h1,h2,h3"
const MC_INLINE_TAGS = new Set(["span", "em", "strong", "b", "i", "mark", "small", "font", "u"])
const COLOR_NEUTRAL_RE = /^(?:inherit|currentcolor|unset|initial|revert)$/i

// A genuine display HEADLINE is prose: a multi-word phrase with lowercase
// letters. This gate keeps the heading-scoped rules off app patterns that use
// a heading tag but are NOT prose: a stat VALUE ("8.42km" with a colored
// unit), an all-caps brand statement, or a one/two-word screen-header label.
// Deliberately UNDER-reaches; over-removing an app stat's label is the worse
// failure.
function isProseHeadline(h: HTMLElement): boolean {
  const text = h.text.replace(/\s+/g, " ").trim()
  if (!/[a-z]/.test(text)) return false
  return text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length >= 3
}

function lastColorValue(decls: string): string | null {
  let out: string | null = null
  for (const m of decls.matchAll(
    /(?:^|[;{])\s*color\s*:\s*([^;{}!]+?)\s*(?:!important)?\s*(?=;|}|$)/gi,
  ))
    out = m[1].trim()
  return out
}
// Cascade order: class decls first, inline style last (inline wins).
function resolvedColor(el: HTMLElement, map: Map<string, string>): string | null {
  let d = ""
  for (const c of elClass(el).split(/\s+/).filter(Boolean)) d += `;${map.get(c) ?? ""}`
  d += `;${el.getAttribute("style") ?? ""}`
  return lastColorValue(d)
}
function isColoredInline(el: HTMLElement, map: Map<string, string>): boolean {
  const tag = (el.tagName ?? "").toLowerCase()
  const eligible = MC_INLINE_TAGS.has(tag) || (tag === "a" && el.getAttribute("href") == null)
  if (!eligible) return false
  const c = resolvedColor(el, map)
  return !!c && !COLOR_NEUTRAL_RE.test(c)
}
function headingHasBaseText(h: HTMLElement, colored: Set<HTMLElement>): boolean {
  let base = false
  const walk = (n: HTMLElement) => {
    for (const c of n.childNodes as unknown as Array<{ nodeType?: number; rawText?: string }>) {
      if (c.nodeType === 1) {
        const child = c as unknown as HTMLElement
        if (colored.has(child)) continue
        walk(child)
      } else if (c.nodeType === 3 && /[A-Za-z0-9]/.test(String(c.rawText ?? ""))) {
        base = true
      }
    }
  }
  walk(h)
  return base
}
function findMulticolorHeadings(
  root: HTMLElement,
  map: Map<string, string>,
): { heading: HTMLElement; parts: HTMLElement[] }[] {
  const out: { heading: HTMLElement; parts: HTMLElement[] }[] = []
  for (const h of root.querySelectorAll(MC_HEADING_SEL)) {
    if (elAllows(h, "multicolor-heading")) continue // intentional opt-out
    if (!isProseHeadline(h)) continue
    const parts = h.querySelectorAll("*").filter((d) => isColoredInline(d, map))
    if (parts.length === 0) continue
    if (!headingHasBaseText(h, new Set(parts))) continue
    out.push({ heading: h, parts })
  }
  return out
}
function fixMulticolorHeadings(html: string): string {
  const root = parse(html)
  const map = collectClassDecls(html)
  const found = findMulticolorHeadings(root, map)
  if (found.length === 0) return html
  for (const { parts } of found)
    for (const d of parts) {
      const style = (d.getAttribute("style") ?? "")
        .replace(/(?:^|;)\s*color\s*:[^;]*/gi, "")
        .replace(/^\s*;+/, "")
        .trim()
      d.setAttribute(
        "style",
        style ? `${style.replace(/;?\s*$/, "")};color:inherit` : "color:inherit",
      )
    }
  return root.toString()
}

// Mixing upright + italic inside ONE headline. Fires ONLY when there is BOTH
// upright base text AND an italic fragment (a wholly-italic headline is a
// single consistent style, left alone).
const ITALIC_TAGS = new Set(["em", "i", "cite", "var", "address", "dfn"])

function lastFontStyle(decls: string): string | null {
  let out: string | null = null
  for (const m of decls.matchAll(
    /(?:^|[;{])\s*font-style\s*:\s*([^;{}!]+?)\s*(?:!important)?\s*(?=;|}|$)/gi,
  ))
    out = m[1].trim().toLowerCase()
  return out
}
function resolvedItalic(el: HTMLElement, map: Map<string, string>): boolean {
  let d = ""
  for (const c of elClass(el).split(/\s+/).filter(Boolean)) d += `;${map.get(c) ?? ""}`
  d += `;${el.getAttribute("style") ?? ""}`
  const fs = lastFontStyle(d)
  if (fs) return /^(?:italic|oblique)/.test(fs)
  return ITALIC_TAGS.has((el.tagName ?? "").toLowerCase())
}
function findMixedStyleHeadings(
  root: HTMLElement,
  map: Map<string, string>,
): { heading: HTMLElement; parts: HTMLElement[] }[] {
  const out: { heading: HTMLElement; parts: HTMLElement[] }[] = []
  for (const h of root.querySelectorAll(MC_HEADING_SEL)) {
    if (elAllows(h, "mixed-style-headline")) continue // intentional opt-out
    if (!isProseHeadline(h)) continue
    if (resolvedItalic(h, map)) continue // wholly-italic headline is consistent
    const parts = h.querySelectorAll("*").filter((d) => resolvedItalic(d, map))
    if (parts.length === 0) continue
    if (!headingHasBaseText(h, new Set(parts))) continue // require a MIX
    out.push({ heading: h, parts })
  }
  return out
}
function fixMixedStyleHeadings(html: string): string {
  const root = parse(html)
  const map = collectClassDecls(html)
  const found = findMixedStyleHeadings(root, map)
  if (found.length === 0) return html
  for (const { parts } of found)
    for (const d of parts) {
      const style = (d.getAttribute("style") ?? "")
        .replace(/(?:^|;)\s*font-style\s*:[^;]*/gi, "")
        .replace(/^\s*;+/, "")
        .trim()
      d.setAttribute(
        "style",
        style ? `${style.replace(/;?\s*$/, "")};font-style:normal` : "font-style:normal",
      )
    }
  return root.toString()
}

// ---------------------------------------------------------------------------
// hero-kicker-eyebrow helpers. Targets ONLY the element immediately preceding
// the primary <h1> (or the standalone band before the hero block), requires
// short uppercase / tracked text, and skips anything carrying links / lists /
// nav / media so a real top nav or toolbar is never removed. Section-level
// eyebrows (above an h2 list) are intentionally left alone.
// ---------------------------------------------------------------------------

const KICKER_DISQUALIFY_SEL = "a,button,input,textarea,select,form,nav,ul,ol,li,img"

function prevElementSibling(el: HTMLElement): HTMLElement | null {
  const parent = el.parentNode as HTMLElement | null
  if (!parent) return null
  const kids = elementChildren(parent)
  const i = kids.indexOf(el)
  return i > 0 ? kids[i - 1]! : null
}
function subtreeDecls(el: HTMLElement, map: Map<string, string>): string {
  let d = elDecls(el, map)
  for (const c of el.querySelectorAll("*")) d += `;${elDecls(c, map)}`
  return d
}
function isUpperTrackedKicker(decls: string, text: string): boolean {
  if (/text-transform\s*:\s*uppercase/i.test(decls)) return true
  const ls = decls.match(/letter-spacing\s*:\s*([\d.]+)\s*(em|rem|px)/i)
  if (ls) {
    const v = parseFloat(ls[1]!)
    const unit = ls[2]!.toLowerCase()
    if ((unit === "em" || unit === "rem") && v >= 0.08) return true
    if (unit === "px" && v >= 1) return true
  }
  return /[A-Z]/.test(text) && text === text.toUpperCase() && !/[a-z]/.test(text)
}
function findHeroKicker(root: HTMLElement, map: Map<string, string>): HTMLElement | null {
  const h1 = root.querySelector("h1")
  if (!h1 || !isProseHeadline(h1)) return null
  const prev = prevElementSibling(h1)
  if (!prev) return null
  if (/^h[1-6]$/.test((prev.tagName ?? "").toLowerCase())) return null
  if (prev.querySelector(KICKER_DISQUALIFY_SEL)) return null
  if (elAllows(prev, "hero-kicker-eyebrow")) return null
  const text = prev.text.replace(/\s+/g, " ").trim()
  // A real kicker carries WORDS; a bare page index ("01 / 24") is not the
  // restating eyebrow this rule targets.
  if (!/[A-Za-z]/.test(text) || text.length > 60) return null
  if (text.split(/\s+/).filter(Boolean).length > 9) return null
  return isUpperTrackedKicker(subtreeDecls(prev, map), text) ? prev : null
}
// The hero's top-level block: the nearest ancestor of the H1 that is a direct
// child of <body>/<main>. Used to find an eyebrow in its OWN band/section.
function topLevelBlock(el: HTMLElement): HTMLElement {
  let cur = el
  for (;;) {
    const parent = cur.parentNode as HTMLElement | null
    if (!parent) return cur
    const ptag = (parent.tagName ?? "").toLowerCase()
    if (ptag === "body" || ptag === "main" || ptag === "html" || ptag === "") return cur
    cur = parent
  }
}
function findLeadingEyebrowSection(
  root: HTMLElement,
  map: Map<string, string>,
): HTMLElement | null {
  const h1 = root.querySelector("h1")
  if (!h1 || !isProseHeadline(h1)) return null
  const prev = prevElementSibling(topLevelBlock(h1))
  if (!prev) return null
  if (/^h[1-6]$/.test((prev.tagName ?? "").toLowerCase())) return null
  if (prev.querySelector(KICKER_DISQUALIFY_SEL)) return null
  if (elAllows(prev, "hero-kicker-eyebrow")) return null
  const text = prev.text.replace(/\s+/g, " ").trim()
  if (!/[A-Za-z]/.test(text) || text.length > 60) return null
  if (text.split(/\s+/).filter(Boolean).length > 9) return null
  return isUpperTrackedKicker(subtreeDecls(prev, map), text) ? prev : null
}
// Both eyebrow shapes (inline kicker above the H1 + standalone leading band),
// de-duplicated (they coincide when the H1 is itself a top-level block).
function findHeroEyebrows(root: HTMLElement, map: Map<string, string>): HTMLElement[] {
  const out: HTMLElement[] = []
  const inline = findHeroKicker(root, map)
  if (inline) out.push(inline)
  const lead = findLeadingEyebrowSection(root, map)
  if (lead && !out.includes(lead)) out.push(lead)
  return out
}
function fixHeroKicker(html: string): string {
  const root = parse(html)
  const els = findHeroEyebrows(root, collectClassDecls(html))
  if (els.length === 0) return html
  for (const el of els) el.remove()
  return root.toString()
}

// ---------------------------------------------------------------------------
// reveal-specificity-trap helpers. A scroll-reveal HIDDEN state gated behind
// `.js` (`html.js .reveal { opacity: 0 }`, specificity 0-2-1) whose REVEALED
// state is written WITHOUT the gate (`.reveal.in`, 0-2-0) loses the cascade
// forever: the observer fires but the section never appears. The fix prefixes
// the ungated revealed selector with `html.js ` so it ties the gate and wins
// on source order. Idempotent by construction (rewritten selectors no longer
// match).
// ---------------------------------------------------------------------------

function findRevealSpecificityTraps(html: string): {
  hits: SlopHit[]
  fixedHtml: string
} {
  const hits: SlopHit[] = []
  const fixedHtml = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_full, open: string, css: string, close: string) => {
      // 1. Hidden classes: `.js .C` / `html.js .C` rules whose body sets
      //    opacity: 0 (the fail-open hidden state).
      const hidden = new Set<string>()
      for (const m of css.matchAll(
        /(?:html)?\.js\s+\.([A-Za-z_][\w-]*)[^{,]*\{([^}]*)\}/g,
      )) {
        if (/opacity\s*:\s*0(?:[;\s}]|$)/.test(m[2]!)) hidden.add(m[1]!)
      }
      if (hidden.size === 0) return open + css + close
      // 2. Revealed-state selectors for those classes written without the
      //    gate: a selector segment starting with `.C` plus >=1 more class.
      let out = css
      for (const cls of hidden) {
        const segRe = new RegExp(
          String.raw`(^|[,{}]\s*)(\.${cls}(?:\.[\w-]+)+)(\s*[,{])`,
          "g",
        )
        out = out.replace(segRe, (full, pre: string, seg: string, post: string) => {
          hits.push({
            ruleId: "reveal-specificity-trap",
            detail: `\`${seg}\` loses to \`html.js .${cls}\``,
          })
          return `${pre}html.js ${seg}${post}`
        })
      }
      return open + out + close
    },
  )
  return { hits, fixedHtml }
}

// ---------------------------------------------------------------------------
// will-change helpers. Only GPU-compositable props are worth promoting; the
// rest waste a layer. WILL_CHANGE_OK = values the detector treats as fine;
// WILL_CHANGE_KEEP = the strict set the fixer preserves.
// ---------------------------------------------------------------------------

/** Map `fn` over every CSS context (<style> bodies + inline style values). */
function mapCssText(html: string, fn: (css: string) => string): string {
  return html
    .replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_m, open: string, body: string, close: string) => open + fn(body) + close,
    )
    .replace(
      /(\sstyle\s*=\s*")([^"]*)(")/gi,
      (_m, pre: string, css: string, post: string) => pre + fn(css) + post,
    )
}

/** Sum `counter(css)` over every CSS context (<style> bodies + inline styles). */
function countInCss(html: string, counter: (css: string) => number): number {
  let n = 0
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) n += counter(block[1]!)
  for (const inline of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) n += counter(inline[1]!)
  return n
}

const WILL_CHANGE_OK = new Set([
  "transform",
  "opacity",
  "filter",
  "clip-path",
  "scroll-position",
  "contents",
  "auto",
  "initial",
  "inherit",
  "unset",
])
const WILL_CHANGE_KEEP = new Set(["transform", "opacity", "filter", "clip-path"])
const WILL_CHANGE_RE = /will-change\s*:\s*([^;}"]*)(;?)/gi

function willChangeProps(value: string): string[] {
  return splitTopLevel(value, ",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function countWillChangeMisuse(html: string): number {
  return countInCss(html, (css) => {
    if (declsAllow(css, "will-change-misuse")) return 0
    let n = 0
    for (const m of css.matchAll(WILL_CHANGE_RE)) {
      if (willChangeProps(m[1]!).some((p) => !WILL_CHANGE_OK.has(p.toLowerCase()))) n++
    }
    return n
  })
}

function fixWillChange(html: string): string {
  return mapCssText(html, (css) => {
    if (declsAllow(css, "will-change-misuse")) return css
    return css.replace(WILL_CHANGE_RE, (full, value: string, semi: string) => {
      const props = willChangeProps(value)
      if (props.length === 0) return full
      if (props.every((p) => WILL_CHANGE_OK.has(p.toLowerCase()))) return full
      const kept = props.filter((p) => WILL_CHANGE_KEEP.has(p.toLowerCase()))
      // A pure perf hint, so dropping it entirely never changes appearance.
      return kept.length === 0 ? "" : `will-change: ${kept.join(", ")}${semi}`
    })
  })
}

// ---------------------------------------------------------------------------
// image-outline helper: pick the hairline color from the page's own ground.
// A dark UI (body/html background luminance < 0.5) takes the white hairline;
// anything else (or no parseable background) defaults to black.
// ---------------------------------------------------------------------------

function hexLuminance(hex: string): number | null {
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split("").map((c) => c + c).join("")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function pageImageOutlineColor(html: string): string {
  for (const m of html.matchAll(
    /(?:^|[\s>{},;])(?:body|html)\b[^{]*\{([^}]*)\}/gi,
  )) {
    const bg = m[1].match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\b/i)
    if (bg) {
      const lum = hexLuminance(bg[1])
      if (lum !== null && lum < 0.5) return "rgba(255,255,255,0.05)"
      if (lum !== null) return "rgba(0,0,0,0.05)"
    }
  }
  return "rgba(0,0,0,0.05)"
}

// ---------------------------------------------------------------------------
// 0.4.0 canonical-tell helpers (Gap B of the coverage plan): the fingerprint
// colors beyond indigo, glow shadows, type-hygiene extremes, blob cards,
// template structures, and motion tells.
// ---------------------------------------------------------------------------

/** Hue/saturation/lightness of a CSS color, or null when unreadable. */
function colorHSL(raw: string): { h: number; s: number; l: number } | null {
  const hs = colorHueSat(raw)
  if (!hs) return null
  const c = raw.trim().toLowerCase()
  let rgb: [number, number, number] | null = null
  if (c.startsWith("#")) rgb = parseHex(c)
  else {
    const fn = c.match(/rgba?\(([^)]*)\)/i)
    if (fn) {
      const n = fn[1].split(/[\s,/]+/).map(Number).filter(Number.isFinite)
      if (n.length >= 3) rgb = [n[0], n[1], n[2]]
    } else {
      const hslM = c.match(/hsla?\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+([\d.]+)%/i)
      if (hslM) return { ...hs, l: parseFloat(hslM[1]) / 100 }
      const named = c.match(/^[a-z]+/)?.[0]
      if (named && NAMED_RGB[named]) rgb = NAMED_RGB[named]
    }
  }
  if (!rgb) return null
  const [r, g, b] = rgb.map((v) => v / 255)
  return { ...hs, l: (Math.max(r, g, b) + Math.min(r, g, b)) / 2 }
}

/** Every literal color token in a declaration VALUE (hex / rgb() / hsl()). */
const COLOR_TOKEN_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g

/** Walk a decls block declaration by declaration, skipping custom-property
 * definitions, `content:` literals, and url(...) spans, and hand each
 * remaining value to `fn` for a rewritten value (or null to keep it). */
function mapSafeDeclValues(
  decls: string,
  fn: (prop: string, value: string) => string | null,
): string {
  return stripCssComments(decls)
    .split(";")
    .map((d) => {
      const m = d.match(/^(\s*)([-\w]+)(\s*:\s*)([\s\S]*)$/)
      if (!m) return d
      const [, pre, prop, sep, value] = m
      if (prop.startsWith("--") || prop.toLowerCase() === "content") return d
      if (/url\s*\(/i.test(value)) return d
      const next = fn(prop.toLowerCase(), value)
      return next === null ? d : `${pre}${prop}${sep}${next}`
    })
    .join(";")
}

// The wider violet band behind the indigo-accent hex list: any saturated
// purple/violet reads as the generated accent. The exact indigo hexes are
// excluded so indigo-accent (which owns them) never double-counts.
const INDIGO_EXACT_RE =
  /^#(?:6366f1|818cf8|4f46e5|4338ca|3730a3|8b5cf6|7c3aed|6d28d9|a78bfa|5b21b6)$/i
function isVioletWashColor(token: string): boolean {
  if (INDIGO_EXACT_RE.test(token.trim())) return false
  const hsl = colorHSL(token)
  if (!hsl) return false
  return hsl.h >= 252 && hsl.h <= 296 && hsl.s >= 0.3 && hsl.l >= 0.25 && hsl.l <= 0.88
}
// Shadow/filter colors are dark-glow's jurisdiction (a violet glow gets its
// LAYER dropped, never recolored: rewriting a shadow color to var() would
// hide its alpha from the shadow rules and break idempotency).
const VIOLET_SKIP_PROP_RE = /shadow|filter/i
function groupHasVioletWash(decls: string): boolean {
  let found = false
  mapSafeDeclValues(decls, (prop, value) => {
    if (VIOLET_SKIP_PROP_RE.test(prop)) return null
    for (const m of value.matchAll(COLOR_TOKEN_RE)) {
      if (isVioletWashColor(m[0])) found = true
    }
    return null
  })
  return found
}
function fixVioletGroup(decls: string): string {
  return mapSafeDeclValues(decls, (prop, value) => {
    if (VIOLET_SKIP_PROP_RE.test(prop)) return null
    const next = value.replace(COLOR_TOKEN_RE, (tok) =>
      isVioletWashColor(tok) ? "var(--accent, currentColor)" : tok,
    )
    return next === value ? null : next
  })
}

// Tailwind's emerald/green family: the escape-hatch accent models reach for
// once purple is off the table. Advisory only.
const EMERALD_HEX_RE =
  /#(?:10b981|34d399|059669|047857|065f46|22c55e|16a34a|4ade80|15803d)\b/gi
function groupHasSafeGreen(decls: string): boolean {
  let found = false
  mapSafeDeclValues(decls, (_p, value) => {
    if (value.match(EMERALD_HEX_RE)) found = true
    return null
  })
  return found
}

// Chromatic glow: a non-inset box-shadow / text-shadow layer (or a
// drop-shadow() filter) whose color is saturated and whose blur is wide.
// heavy-box-shadow owns neutral over-heavy stacks; this owns NEON.
function shadowLayerColor(layer: string): string | null {
  const m = layer.match(COLOR_TOKEN_RE)
  return m ? m[0] : null
}
function isChromaticGlowLayer(layer: string): boolean {
  if (/\binset\b/i.test(layer)) return false
  const lengths = shadowLayerLengths(layer)
  const blur = lengths.length >= 3 ? lengths[2] : 0
  if (blur < 12) return false
  const color = shadowLayerColor(layer)
  if (!color) return false
  const hsl = colorHSL(color)
  if (!hsl || hsl.s < 0.4) return false
  const alpha = shadowLayerAlpha(layer)
  return alpha >= 0.15
}
const SHADOW_DECL_RE = /((?:^|[;{\s])(?:box-shadow|text-shadow)\s*:\s*)([^;}]+)/gi
const DROP_SHADOW_FN_RE = /drop-shadow\(([^)]*)\)/gi
function countDarkGlow(decls: string): number {
  let n = 0
  for (const m of decls.matchAll(SHADOW_DECL_RE)) {
    for (const layer of splitTopLevelCommas(m[2])) {
      if (isChromaticGlowLayer(layer)) n++
    }
  }
  for (const m of decls.matchAll(DROP_SHADOW_FN_RE)) {
    if (isChromaticGlowLayer(m[1])) n++
  }
  return n
}
function stripDarkGlow(decls: string): string {
  let out = decls.replace(SHADOW_DECL_RE, (full, pre: string, value: string) => {
    const kept = splitTopLevelCommas(value).filter((l) => !isChromaticGlowLayer(l))
    if (kept.length === 0) return "" // glow was the whole shadow: drop it
    return `${pre}${kept.map((l) => l.trim()).join(", ")}`
  })
  out = out.replace(DROP_SHADOW_FN_RE, (full, inner: string) =>
    isChromaticGlowLayer(inner) ? "" : full,
  )
  return out
}

// The warm-cream "tasteful startup" wash: a cream page ground plus a serif
// display voice. Advisory; editorial briefs earn it, defaults don't.
function pageBackgroundHSL(html: string): { h: number; s: number; l: number } | null {
  for (const m of html.matchAll(/(?:^|[\s>{},;])(?:body|html)\b[^{]*\{([^}]*)\}/gi)) {
    const bg = m[1].match(/background(?:-color)?\s*:\s*([^;}]+)/i)
    if (bg) {
      const tok = bg[1].match(COLOR_TOKEN_RE)?.[0]
      if (tok) return colorHSL(tok)
    }
  }
  return null
}
function pageHasSerifDisplay(html: string): boolean {
  for (const m of html.matchAll(/font-family\s*:\s*([^;}"]+)/gi)) {
    const v = m[1].toLowerCase()
    if (/\bserif\b/.test(v) && !/sans-serif\s*$/.test(v.trim()) && !/\bsans\b/.test(v.split(",")[0] ?? ""))
      return true
  }
  return false
}

// Overused display faces: the four families every list of AI tells names.
const OVERUSED_FONT_RE = /\b(?:Inter|Space\s+Grotesk|Geist|Instrument\s+Serif)\b/gi
function findOverusedFonts(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const f of m[1].matchAll(OVERUSED_FONT_RE)) found.add(f[0].replace(/\s+/g, " "))
  }
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*/gi)) {
    for (const f of decodeURIComponent(m[0]).replace(/\+/g, " ").matchAll(OVERUSED_FONT_RE))
      found.add(f[0].replace(/\s+/g, " "))
  }
  return [...found]
}

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "math", "emoji",
  "inherit", "initial", "unset",
])
/** Distinct leading (non-generic) family names declared on the page. */
function declaredFamilies(html: string): string[] {
  const out = new Set<string>()
  let decls = 0
  for (const m of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    decls++
    const first = splitTopLevelCommas(m[1])[0]?.trim().replace(/^["']|["']$/g, "") ?? ""
    if (first && !GENERIC_FAMILIES.has(first.toLowerCase())) out.add(first.toLowerCase())
  }
  return decls >= 2 ? [...out] : ["", ""] // <2 decls: report as "diverse" (no hit)
}

// Type-hygiene extremes. Each predicate walks one decls group.
function trackingEm(value: string): number | null {
  const m = value.match(/(-?[\d.]+)\s*(em|rem|px)/i)
  if (!m) return null
  const v = parseFloat(m[1])
  return m[2].toLowerCase() === "px" ? v / 16 : v
}
function groupHasCrushedTracking(decls: string): boolean {
  const m = decls.match(/letter-spacing\s*:\s*([^;}]+)/i)
  if (!m) return false
  const em = trackingEm(m[1])
  return em !== null && em <= -0.05
}
function fixCrushedTracking(decls: string): string {
  return decls.replace(/(letter-spacing\s*:\s*)([^;}]+)/gi, (full, pre: string, v: string) => {
    const em = trackingEm(v)
    return em !== null && em <= -0.05 ? `${pre}-0.02em` : full
  })
}
function groupHasWideBodyTracking(decls: string): boolean {
  if (/text-transform\s*:\s*uppercase/i.test(decls)) return false // tracked caps are a real pattern
  const fs = decls.match(/font-size\s*:\s*([\d.]+)px/i)
  if (fs && parseFloat(fs[1]) <= 13) return false // micro-labels track wide legitimately
  const m = decls.match(/letter-spacing\s*:\s*([^;}]+)/i)
  if (!m) return false
  const em = trackingEm(m[1])
  return em !== null && em >= 0.08
}
function fixWideBodyTracking(decls: string): string {
  return decls.replace(/(letter-spacing\s*:\s*)([^;}]+)/gi, (full, pre: string, v: string) => {
    const em = trackingEm(v)
    return em !== null && em >= 0.08 ? `${pre}0.01em` : full
  })
}
function groupHasTightLineHeight(decls: string): boolean {
  const fs = decls.match(/font-size\s*:\s*([\d.]+)px/i)
  if (!fs) return false // no size in the group: inheritance unknown, stay quiet
  const size = parseFloat(fs[1])
  if (size < 13 || size > 20) return false // display + micro sizes set their own rules
  const lh = decls.match(/line-height\s*:\s*([\d.]+)(px)?/i)
  if (!lh) return false
  const v = parseFloat(lh[1])
  const ratio = lh[2] ? v / size : v
  return ratio > 0 && ratio < 1.25
}
function fixTightLineHeight(decls: string): string {
  if (!groupHasTightLineHeight(decls)) return decls
  return decls.replace(/(line-height\s*:\s*)([\d.]+)(px)?/i, "$11.4")
}
function groupHasTinyBodyText(decls: string): boolean {
  if (/text-transform\s*:\s*uppercase/i.test(decls)) return false // tracked micro-labels
  const m = decls.match(/font-size\s*:\s*([\d.]+)(px|rem|em)/i)
  if (!m) return false
  const v = parseFloat(m[1])
  const px = m[2].toLowerCase() === "px" ? v : v * 16
  return px > 0 && px < 11
}
function fixTinyBodyText(decls: string): string {
  if (!groupHasTinyBodyText(decls)) return decls
  return decls.replace(/(font-size\s*:\s*)([\d.]+)(px|rem|em)/i, (_f, pre: string) => `${pre}12px`)
}

const MONO_FAMILY_RE = /font-family\s*:[^;}]*(?:\bmonospace\b|\bmono\b|courier|consolas|menlo)/i
function countMonospaceBody(html: string): number {
  let n = 0
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of stripCssComments(block[1]).matchAll(STYLE_RULE_RE)) {
      const sel = rule[1]
      const bodyOrP = /(?:^|[\s,}])(?:body|p)\s*(?:[,{]|$)/i.test(`${sel}{`)
      if (bodyOrP && MONO_FAMILY_RE.test(`font-family:${rule[2].match(/font-family\s*:\s*([^;}]+)/i)?.[1] ?? ""}`))
        n++
    }
  }
  return n
}

// Blob cards + ghost cards.
function cardRadiusPx(decls: string): number | null {
  const m = decls.match(/border-radius\s*:\s*([\d.]+)px\b/i)
  return m ? parseFloat(m[1]) : null
}
function groupIsOverRounded(decls: string): boolean {
  if (!hasRealFill(decls)) return false
  const r = cardRadiusPx(decls)
  return r !== null && r >= 40 && r <= 120
}
function fixOverRounded(decls: string): string {
  if (!groupIsOverRounded(decls)) return decls
  return decls.replace(/(border-radius\s*:\s*)([\d.]+)px\b/i, "$124px")
}
function groupIsGhostCard(decls: string): boolean {
  const hairline = /border[^;:]*:\s*(?:0?\.5|1)px\b/i.test(decls)
  if (!hairline) return false
  for (const m of decls.matchAll(SHADOW_DECL_RE)) {
    for (const layer of splitTopLevelCommas(m[2])) {
      if (/\binset\b/i.test(layer)) continue
      const lengths = shadowLayerLengths(layer)
      const blur = lengths.length >= 3 ? lengths[2] : 0
      const alpha = shadowLayerAlpha(layer)
      if (blur >= 24 && alpha > 0 && alpha <= 0.18) return true
    }
  }
  return false
}
function stripGhostShadow(decls: string): string {
  if (!groupIsGhostCard(decls)) return decls
  return decls
    .split(";")
    .filter((d) => !/^\s*(?:box-shadow)\s*:/i.test(d))
    .join(";")
}

// Nested cards: a card-surfaced CONTAINER inside another card surface.
// Chips/badges/buttons (small filled+rounded leaves) are not containers.
function isCardContainer(el: HTMLElement, map: Map<string, string>): boolean {
  const tag = (el.tagName ?? "").toLowerCase()
  if (tag === "button" || tag === "a" || tag === "span") return false
  if (!declsHaveCardSurface(elDecls(el, map))) return false
  const kids = elementChildren(el)
  return kids.length >= 2 || el.querySelector("h1,h2,h3,h4,h5,h6,p") != null
}
function findNestedCards(root: HTMLElement, map: Map<string, string>): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const el of root.querySelectorAll("div,section,article,aside,li,figure")) {
    if (!isCardContainer(el, map)) continue
    if (elAllows(el, "nested-cards")) continue
    for (let p = el.parentNode as HTMLElement | null; p; p = p.parentNode as HTMLElement | null) {
      if (typeof p.getAttribute === "function" && declsHaveCardSurface(elDecls(p, map))) {
        out.push(el)
        break
      }
    }
  }
  return out
}

// Decorative "01 / 02 / 03" scaffolding: leading-zero index leaves.
function findNumberedMarkers(root: HTMLElement): HTMLElement[] {
  const hits: HTMLElement[] = []
  for (const el of root.querySelectorAll("*")) {
    if (el.querySelectorAll("*").length > 0) continue
    const text = el.text.replace(/\s+/g, " ").trim()
    if (/^0[1-9][.)/]?$/.test(text)) hits.push(el)
  }
  return hits.length >= 2 ? hits : []
}

// The universal feature-card template: icon on top, heading, blurb, x3.
function isIconToppedCard(row: HTMLElement): boolean {
  const kids = elementChildren(row)
  if (kids.length < 2) return false
  const first = kids[0]!
  const firstTag = (first.tagName ?? "").toLowerCase()
  const leadIcon =
    firstTag === "svg" ||
    firstTag === "img" ||
    ((firstTag === "div" || firstTag === "span") &&
      elementChildren(first).length === 1 &&
      ["svg", "img"].includes((elementChildren(first)[0]!.tagName ?? "").toLowerCase()) &&
      textRuns(first).length === 0)
  if (!leadIcon) return false
  return row.querySelector("h2,h3,h4,h5") != null && row.querySelector("p") != null
}
function findIconToppedCardSets(root: HTMLElement): HTMLElement[][] {
  const out: HTMLElement[][] = []
  for (const rows of repeatingRowSets(root, 3)) {
    const matched = rows.filter((r) => !elAllows(r, "icon-topped-feature-card") && isIconToppedCard(r))
    if (matched.length >= 3) out.push(matched)
  }
  return out
}

// Motion tells.
const CUBIC_BEZIER_RE = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/gi
function bezierOvershoots(y1: string, y2: string): boolean {
  const a = parseFloat(y1)
  const b = parseFloat(y2)
  return a < 0 || a > 1 || b < 0 || b > 1
}
function countBounceEasing(decls: string): number {
  let n = 0
  for (const m of decls.matchAll(CUBIC_BEZIER_RE)) {
    if (bezierOvershoots(m[2], m[4])) n++
  }
  return n
}
function fixBounceEasing(decls: string): string {
  return decls.replace(CUBIC_BEZIER_RE, (full, _x1, y1: string, _x2, y2: string) =>
    bezierOvershoots(y1, y2) ? "ease-out" : full,
  )
}

const LAYOUT_TRANSITION_PROP_RE =
  /^(?:width|height|max-width|max-height|top|left|right|bottom|inset|margin(?:-\w+)?|padding(?:-\w+)?)$/i
function transitionNamesLayoutProp(value: string): boolean {
  return splitTopLevelCommas(value).some((seg) =>
    LAYOUT_TRANSITION_PROP_RE.test(seg.trim().split(/\s+/)[0] ?? ""),
  )
}
function countLayoutPropTransitions(html: string): number {
  return countInCss(html, (css) => {
    if (declsAllow(css, "layout-prop-animation")) return 0
    let n = 0
    for (const m of css.matchAll(/transition(?:-property)?\s*:\s*([^;}"]*)/gi)) {
      if (transitionNamesLayoutProp(m[1]!)) n++
    }
    return n
  })
}

function countHoverScaleImage(html: string): number {
  let n = 0
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of stripCssComments(block[1]).matchAll(STYLE_RULE_RE)) {
      const sel = rule[1]
      if (!/:hover/i.test(sel)) continue
      if (!/(?:^|[\s,.>+~#-])(?:img|image|thumb|photo|media|cover|card)/i.test(sel)) continue
      const scale = rule[2].match(/transform\s*:[^;}]*\bscale\(\s*([\d.]+)/i)
      if (scale && parseFloat(scale[1]) > 1) n++
    }
  }
  return n
}

// ---------------------------------------------------------------------------
// UI-microcopy helpers (Gap C): deterministic copy tells, scoped to the
// artifact's visible text only.
// ---------------------------------------------------------------------------

function visibleTextRuns(html: string): string[] {
  const runs: string[] = []
  eachVisibleText(html, (t) => {
    const clean = t.replace(/\s+/g, " ").trim()
    if (clean) runs.push(clean)
    return t
  })
  return runs
}

// Benefit-speak: the marketing verbs that sell nothing specific. "Unlock"
// only in its marketing collocation so "Unlock with Face ID" stays legal.
const BENEFIT_SPEAK_RE =
  /\b(?:elevate|supercharge|streamline|empower|effortless(?:ly)?|seamless(?:ly)?|revolutioni[sz]e|game.chang(?:er|ing)|world.class|next.level|unleash|turbocharge)\b|\bunlock (?:the|your|a|new)\b/gi

const NOT_X_BUT_Y_RE =
  /\b(?:it'?s|this is|we'?re|that'?s) not (?:just |merely |simply )?[^.!?;,]{2,48}[.;,] ?(?:it'?s|this is|it is|but) /i

const FABRICATED_PRECISION_RE =
  /\b99\.9{1,2}%|\b(?:10|100)x\b|#1\b|\btrusted by (?:[\d,.]+[km]?\+?|thousands|millions)\b/gi

const APOLOGETIC_ERROR_RE = /\b(?:oops|whoops|uh[- ]?oh)\b[!.]?|something went wrong/gi

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const FLAGSHIP_RULES: SlopRule<SlopCtx>[] = [
  {
    id: "justified-text",
    category: "quality",
    tell: "Justified text creates uneven 'rivers of white' without hyphenation.",
    prevention:
      "Never set text-align:justify on body copy. Use text-align:left; justified UI text creates rivers of white.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      [...html.matchAll(/text-align\s*:\s*justify/gi)].map(
        (): SlopHit => ({ ruleId: "justified-text", detail: "text-align:justify" }),
      ),
    fix: (html) => html.replace(/(text-align\s*:\s*)justify/gi, "$1left"),
  },
  {
    id: "underlined-text",
    category: "type",
    tell: "Underlined UI text reads as a hyperlink or a typewriter document, never as polished product type.",
    prevention:
      "Never underline text. No text-decoration:underline, no <u> tags, and never fake an underline with a border-bottom line under a text run. Links are NOT underlined in UI; set text-decoration:none. Emphasis comes from weight, size, or color.",
    tier: "fix",
    severity: 1,
    detect: (html) => {
      const hits: SlopHit[] = []
      for (const m of html.matchAll(
        /text-decoration(?:-line)?\s*:\s*[^;"'}]*\bunderline\b/gi,
      ))
        hits.push({ ruleId: "underlined-text", detail: m[0].slice(0, 40) })
      for (const _ of html.matchAll(/<\/?u(?=[\s>/])[^>]*>/gi))
        hits.push({ ruleId: "underlined-text", detail: "<u> tag" })
      return hits
    },
    fix: (html) =>
      html
        .replace(
          /text-decoration(-line)?\s*:\s*[^;"'}]*\bunderline\b[^;"'}]*/gi,
          "text-decoration:none",
        )
        .replace(/<\/?u(?=[\s>/])[^>]*>/gi, ""),
  },
  {
    id: "gradient-text",
    category: "color",
    tell: "Gradient text (background-clip:text) is decorative, not meaningful; a classic AI tell on headings and metrics.",
    prevention:
      "Never clip a gradient into text (background-clip:text + color:transparent). Set headings/metrics in a solid color.",
    tier: "fix",
    severity: 1,
    sanctionedBy: (_styleRef, ctx) => ctx?.replicate === true,
    detect: (html) => {
      const n = eachStyleAndInline(html, isGradientTextGroup)
      return Array.from(
        { length: n },
        (): SlopHit => ({ ruleId: "gradient-text", detail: "background-clip:text + transparent fill" }),
      )
    },
    fix: (html) => rewriteCssGroups(html, isGradientTextGroup, fixGradientTextGroup),
  },
  {
    id: "hollow-text",
    category: "type",
    tell: "Hollow / outlined letterforms (color:transparent carried only by -webkit-text-stroke) render invisible where the non-standard stroke isn't painted; fails WCAG.",
    prevention:
      "Never set color:transparent with -webkit-text-stroke as the only thing carrying a glyph (hollow/outlined type). Use a solid fill; for a quieter read, reduce opacity.",
    tier: "fix",
    severity: 2,
    detect: (html) => {
      const n = eachStyleAndInline(html, isHollowTextGroup)
      return Array.from(
        { length: n },
        (): SlopHit => ({ ruleId: "hollow-text", detail: "color:transparent + text-stroke" }),
      )
    },
    fix: (html) => rewriteCssGroups(html, isHollowTextGroup, fixHollowTextGroup),
  },
  {
    id: "indigo-accent",
    category: "color",
    tell: "Tailwind indigo/violet (#6366f1, #8b5cf6, #7c3aed ...) as the accent: the single most common generated-UI fingerprint color.",
    prevention:
      "Never default to indigo/violet (#6366f1, #818cf8, #8b5cf6, #7c3aed ...) as the accent unless the brief explicitly asks for it. Use the brand accent.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasIndigo) },
        (): SlopHit => ({ ruleId: "indigo-accent", detail: "Tailwind indigo/violet hex" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupHasIndigo, fixIndigoGroup),
  },
  {
    id: "heavy-box-shadow",
    category: "visual",
    tell: "A heavy or stacked drop-shadow (multi-layer ambient, or a single blurred layer at alpha > 0.30) under a routine card: the 'puffy floating card' generated-UI signature.",
    prevention:
      "Never stack multiple drop-shadows or use a heavy ambient shadow (alpha > 0.3) on routine cards. Use ONE subtle elevation or rely on surface-tone contrast.",
    tier: "fix",
    severity: 2,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasSlopShadow) },
        (): SlopHit => ({ ruleId: "heavy-box-shadow", detail: "stacked / heavy drop-shadow" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupHasSlopShadow, flattenSlopShadows),
  },
  {
    id: "gradient-border",
    category: "visual",
    tell: "A multi-stop gradient ring around a thumbnail/avatar/card (border-image: linear-gradient): decorative chrome and a loud generated-UI tell.",
    prevention:
      "Never wrap a thumbnail, avatar, image, card, or pill in a gradient border/ring. The element's own rounded corners ARE the finish; add nothing around them.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      [...html.matchAll(GRADIENT_BORDER_RE)].map(
        (): SlopHit => ({ ruleId: "gradient-border", detail: "border-image gradient ring" }),
      ),
    fix: (html) => html.replace(GRADIENT_BORDER_STRIP_RE, ""),
  },
  {
    id: "bare-hr",
    category: "visual",
    tell: "A bare <hr> renders as a full-opacity 3D divider; hairline dividers read cleaner.",
    prevention:
      "Never use a bare <hr>. Separate sections with spacing/typography, or a hairline (alpha <= 0.08) divider.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      [...html.matchAll(/<hr\b([^>]*)>/gi)]
        .filter((m) => !/border/i.test(m[1]) && !tagAllows(m[1], "bare-hr"))
        .map((): SlopHit => ({ ruleId: "bare-hr", detail: "<hr> with no border style" })),
    fix: (html) =>
      html.replace(/<hr\b([^>]*)>/gi, (full, attrs: string) => {
        if (/border/i.test(attrs) || tagAllows(attrs, "bare-hr")) return full
        const hair = "border:none;border-top:1px solid rgba(0,0,0,0.08);"
        const styleM = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i)
        if (styleM) {
          const merged = `${styleM[1].replace(/;?\s*$/, "")}; ${hair}`
          return `<hr${attrs.replace(styleM[0], ` style="${merged}"`)}>`
        }
        return `<hr${attrs} style="${hair}">`
      }),
  },
  {
    id: "decorative-divider",
    category: "visual",
    tell: "Box-drawing characters or em-dash runs used as a decorative rule between labels: chrome that conveys nothing.",
    prevention:
      "Never use box-drawing characters or dash runs as visual dividers between labels or sections. Separate with whitespace, a low-alpha hairline, or surface-tone contrast.",
    tier: "fix",
    severity: 1,
    detect: (html): SlopHit[] => detectDecorativeDividers(html),
    fix: (html) =>
      eachVisibleText(html, (t) => t.replace(BOXRUN_RE, "").replace(DASHRUN_RE, "")),
  },
  {
    id: "missing-lang",
    category: "quality",
    tell: "<html> without a lang attribute breaks screen-reader language detection.",
    prevention: 'Always set lang on the <html> element (e.g. <html lang="en">).',
    tier: "fix",
    severity: 1,
    detect: (html) => {
      const m = html.match(/<html\b([^>]*)>/i)
      return m && !/\blang\s*=/i.test(m[1])
        ? [{ ruleId: "missing-lang", detail: "<html> has no lang" }]
        : []
    },
    fix: (html) =>
      html.replace(/<html\b([^>]*)>/i, (full, attrs: string) =>
        /\blang\s*=/i.test(attrs) ? full : `<html lang="en"${attrs}>`,
      ),
  },
  {
    id: "all-caps-body",
    category: "type",
    tell: "Long passages in uppercase are hard to read; we recognize words by ascender/descender shape.",
    prevention:
      "Never set text-transform:uppercase on long body passages. Reserve all-caps for short labels (a few words at most).",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      [...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
        .filter(
          (m) =>
            /text-transform\s*:\s*uppercase/i.test(m[1]) &&
            visibleLen(m[2]) > 60 &&
            !tagAllows(m[1], "all-caps-body"),
        )
        .map((): SlopHit => ({ ruleId: "all-caps-body", detail: "<p> uppercase, >60 chars" })),
    fix: (html) =>
      html.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs: string, inner: string) => {
        if (
          !/text-transform\s*:\s*uppercase/i.test(attrs) ||
          visibleLen(inner) <= 60 ||
          tagAllows(attrs, "all-caps-body")
        )
          return full
        const newAttrs = attrs.replace(/text-transform\s*:\s*uppercase\s*;?/i, "")
        return `<p${newAttrs}>${inner}</p>`
      }),
  },
  {
    id: "broken-image",
    category: "imagery",
    tell: "<img> with empty, missing, or placeholder src ships as a broken-image box.",
    prevention:
      "Never emit an <img> with empty/missing/placeholder src. Use a real asset or omit the element.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      [...html.replace(RAW_REGION_RE, "").matchAll(IMG_TAG_RE)]
        .filter((m) => isBrokenImg(m[0]))
        .map((): SlopHit => ({ ruleId: "broken-image", detail: "<img> with empty/placeholder src" })),
    fix: (html) =>
      outsideRawRegions(html, (c) => c.replace(IMG_TAG_RE, (tag) => (isBrokenImg(tag) ? "" : tag))),
  },
  {
    id: "emoji-icon",
    category: "type",
    tell: "A leading emoji used as an icon glyph on a label / nav item / heading / button: an icon system is the real affordance.",
    prevention:
      "Never use an emoji as an icon or leading glyph on a label, nav item, heading, or button. Use a real icon or no glyph.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      [...html.matchAll(emojiIconRe())]
        .filter((m) => !tagAllows(m[1], "emoji-icon"))
        .map(
          (): SlopHit => ({ ruleId: "emoji-icon", detail: "leading emoji on a label/nav/heading" }),
        ),
    fix: (html) =>
      html.replace(emojiIconRe(), (full: string, tag: string) =>
        tagAllows(tag, "emoji-icon") ? full : tag,
      ),
  },
  {
    id: "cents-suffix",
    category: "copy",
    tell: "A price split into a base + a smaller cents/decimal suffix span makes a mockup read as a live screen-recording.",
    prevention:
      "Use whole-number mockup data. Never split a price into a base + a smaller cents suffix span (e.g. $28,461 then a .20 span).",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: [...html.matchAll(centsRe())].length },
        (): SlopHit => ({ ruleId: "cents-suffix", detail: "cents/decimal suffix span" }),
      ),
    fix: (html) => fixCents(html),
  },
  {
    id: "oversized-number",
    category: "copy",
    tell: "A long un-abbreviated figure (e.g. $1,842,000) overflows its container and reads as a live screen-recording rather than mockup data.",
    prevention:
      "Keep every numeric value <= 9,999 as raw digits. Abbreviate any magnitude >= 10,000 to K/M/B with at most one decimal (1,842,000 -> 1.8M); never print a raw figure longer than four digits.",
    tier: "fix",
    severity: 1,
    detect: (html) => detectOversizedNumbers(html),
    fix: (html) => fixOversizedNumbers(html),
  },
  {
    id: "transition-all",
    category: "motion",
    tell: "transition: all animates every mutable property (layout, color, shadow) instead of naming the one that should move: the lazy default behind janky, accidental motion.",
    prevention:
      "Never write transition: all (or transition-property: all). Name the exact properties to animate, e.g. transition: transform 200ms ease-out, opacity 200ms ease-out.",
    tier: "gate",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasTransitionAll) },
        (): SlopHit => ({ ruleId: "transition-all", detail: "transition: all" }),
      ),
  },
  {
    id: "em-dash-copy",
    category: "copy",
    tell: "An em dash mid-sentence is the single most recognizable generated-TEXT tell; polished interface copy uses commas, colons, and periods.",
    prevention:
      "Never use an em dash (or a spaced en dash) in interface copy. Use a comma, colon, semicolon, or period. Unspaced en-dash ranges (Mon-Fri, 1-5) are fine.",
    tier: "fix",
    severity: 1,
    detect: (html) => {
      const hits: SlopHit[] = []
      eachVisibleText(html, (text) => {
        const n = countEmDashes(text)
        for (let i = 0; i < n; i++)
          hits.push({ ruleId: "em-dash-copy", detail: "em dash in copy" })
        return text // detect-only: never mutate
      })
      return hits
    },
    fix: (html) => eachVisibleText(html, fixEmDashes),
  },
  {
    id: "lorem-ipsum",
    category: "copy",
    tell: "Lorem-ipsum filler in a finished screen reads as an abandoned template; realistic domain copy is what makes a mockup feel designed.",
    prevention:
      "Never emit lorem-ipsum filler. Write short, realistic copy for the product's actual domain (no fix can invent it for you).",
    tier: "gate",
    severity: 2,
    detect: (html) => {
      const hits: SlopHit[] = []
      eachVisibleText(html, (text) => {
        for (const m of text.matchAll(new RegExp(LOREM_SRC, "gi")))
          hits.push({ ruleId: "lorem-ipsum", detail: `"${m[0]}"` })
        return text // detect-only: never mutate
      })
      return hits
    },
  },
  {
    id: "missing-alt",
    category: "imagery",
    tell: '<img> without an alt attribute makes a screen reader announce the raw filename; even alt="" (decorative) is a decision, silence is not.',
    prevention:
      'Give every <img> an alt attribute: a short content description for meaningful images, alt="" for purely decorative ones.',
    tier: "fix",
    severity: 1,
    detect: (html) =>
      [...html.replace(RAW_REGION_RE, "").matchAll(IMG_TAG_RE)]
        .filter((m) => isAltlessImg(m[0]))
        .map((): SlopHit => ({ ruleId: "missing-alt", detail: "<img> with no alt" })),
    fix: (html) =>
      outsideRawRegions(html, (c) =>
        c.replace(IMG_TAG_RE, (tag) =>
          isAltlessImg(tag) ? tag.replace(/\s*(\/?)>$/, ' alt=""$1>') : tag,
        ),
      ),
  },
  {
    id: "placeholder-image",
    category: "imagery",
    tell: "A stock placeholder-service URL (pravatar, placehold.co, picsum ...) shipped as a real asset: the screen was never finished with real imagery.",
    prevention:
      "Never ship placeholder-service imagery (i.pravatar.cc, ui-avatars.com, placehold.co, picsum.photos ...). Use a real asset or drop the image; no fix can choose one for you.",
    tier: "gate",
    severity: 1,
    detect: (html) =>
      [...html.replace(RAW_REGION_RE, "").matchAll(IMG_TAG_RE)]
        .filter((m) => isPlaceholderServiceImg(m[0]))
        .map(
          (): SlopHit => ({
            ruleId: "placeholder-image",
            detail: "placeholder-service src",
          }),
        ),
  },

  // ---- color: entity gradient fills ----------------------------------------
  {
    id: "gradient-fill",
    category: "color",
    tell: "A rounded entity (icon tile, card, chip, avatar, filled button) filled with a gradient: a single solid color reads cleaner; the gradient is a generated-UI tell.",
    prevention:
      "Never fill an entity (icon tile, card, chip, avatar, filled button) with a gradient: no linear/radial/conic-gradient as its background. A single solid color is the fill, even when the visual reference uses a gradient.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, isSingleEntityFill) },
        (): SlopHit => ({ ruleId: "gradient-fill", detail: "gradient entity fill, flattened to solid" }),
      ),
    fix: (html) => rewriteCssGroups(html, isSingleEntityFill, (d) => fixEntityFill(d, "single")),
  },
  {
    id: "multicolor-fill",
    category: "color",
    tell: "Multiple competing hues across an entity's background (a two-color gradient on an icon tile/card): a loud generated-UI tell.",
    prevention:
      "Never blend multiple hues across an entity's background (e.g. a pink-to-purple or orange-to-pink gradient on an icon tile/card). Fill it with ONE muted neutral surface tone, never two competing colors.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, isMultiEntityFill) },
        (): SlopHit => ({ ruleId: "multicolor-fill", detail: "multi-hue entity fill, muted" }),
      ),
    fix: (html) => rewriteCssGroups(html, isMultiEntityFill, (d) => fixEntityFill(d, "multi")),
  },
  {
    id: "repeating-gradient-stripe",
    category: "visual",
    tell: "Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature.",
    prevention:
      "Never use repeating-linear/radial-gradient stripes as surface decoration. Use a flat fill or a deliberate, meaningful pattern.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      [...html.matchAll(/repeating-(?:linear|radial|conic)-gradient\s*\(/gi)].map(
        (): SlopHit => ({ ruleId: "repeating-gradient-stripe", detail: "repeating-*-gradient()" }),
      ),
    fix: (html) =>
      replaceBalanced(
        html,
        /repeating-(?:linear|radial|conic)-gradient\s*\(/gi,
        (_full, inner) => firstColor(inner) ?? "transparent",
      ).out,
  },

  // ---- dataviz honesty ------------------------------------------------------
  {
    id: "fake-dot-viz",
    category: "visual",
    tell: "A row of equal colored dots/nodes faking a 'momentum'/'pulse' chart conveys nothing and collides with the value column.",
    prevention:
      "Never fake a chart with a cluster of equal dots/nodes in a list row. Use a real sparkline or a plain number + delta.",
    tier: "fix",
    severity: 2,
    detect: (html) =>
      [...html.matchAll(DOT_CLUSTER_RE)].map(
        (): SlopHit => ({ ruleId: "fake-dot-viz", detail: ">=3 empty dot/node cluster in a viz-ish wrapper" }),
      ),
    fix: (html) => html.replace(DOT_CLUSTER_RE, ""),
  },
  {
    id: "viz-stray-ticks",
    category: "visual",
    tell: "Short radiating tick <line>s sprayed on a gauge/arc (e.g. 7 unlabeled 8px segments around a rating dial): decorative chrome that encodes nothing and reads as the strongest generated-gauge tell.",
    prevention:
      "Never draw decorative tick marks on a gauge or arc. A rating/score gauge needs ONLY the arc, the value, and (at most) two endpoint labels: no radiating <line> ticks around the rim. They are unlabeled chrome and convey nothing.",
    tier: "fix",
    severity: 2,
    detect: (html) =>
      findStrayVizTicks(parse(html)).map(
        (): SlopHit => ({ ruleId: "viz-stray-ticks", detail: "short ungrouped tick <line> on a gauge/arc" }),
      ),
    fix: (html) => fixStrayVizTicks(html),
  },
  {
    id: "viz-redundant-scale",
    category: "copy",
    tell: "A gauge states its scale twice: a '/N' suffix on the value (7/10) AND separate '0' and 'N' endpoint labels on the arc. The endpoints are redundant once the value carries the denominator.",
    prevention:
      "State a gauge's scale ONCE. If the value already shows a denominator (7/10, 68%), do NOT also label the arc endpoints with 0 and N: the endpoints are redundant. Use descriptive endpoint labels (TODAY / GOAL) or none.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      findRedundantScaleTexts(parse(html), collectClassDecls(html)).map(
        (t): SlopHit => ({
          ruleId: "viz-redundant-scale",
          detail: `redundant endpoint "${(t.text ?? "").trim()}"`,
        }),
      ),
    fix: (html) => fixRedundantScaleTexts(html),
  },
  {
    id: "glyph-on-metric",
    category: "visual",
    tell: "A decorative emoji, catalog icon, or trend glyph placed on or over a numeric value: an emoji centered behind a progress-ring's percentage, an arrow or icon beside a stat's NN%. The number is the visual; the glyph collides with or pollutes it.",
    prevention:
      "Never place a decorative emoji, catalog icon, illustration, mascot, or blob on, over, behind, or beside a numeric value (a KPI, percentage, stat, score, progress-ring/arc value, gauge, or dial reading). The number IS the imagery. For a ring/arc/gauge the only marks are the arc, the value, and at most two endpoint labels. In any stat unit that shows a percentage, render the number and its text label alone: no leading emoji, no trend-arrow glyph, no icon chip beside the value.",
    tier: "fix",
    severity: 2,
    detect: (html) => detectGlyphOnMetric(html),
    fix: (html) => fixGlyphOnMetric(html),
  },
  {
    id: "stat-label-icon",
    category: "visual",
    tell: "A number-over-category stat tile whose category label is prefixed with an icon: the label word already names the category, so the leading icon duplicates information and adds visual noise.",
    prevention:
      "In a stat/metric/filter tile that pairs a number with a category label, never prefix the category label with an icon: the word already names the category, so a leading icon is duplicate information and visual pollution. Show just the number + the text label.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      findStatLabelIcons(parse(html)).map(
        (lead): SlopHit => ({
          ruleId: "stat-label-icon",
          detail: `leading icon on "${((lead.parentNode as HTMLElement | null)?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 20)}"`,
        }),
      ),
    fix: (html) => {
      const root = parse(html)
      const leads = findStatLabelIcons(root)
      if (leads.length === 0) return html
      for (const lead of leads) lead.remove()
      return root.toString()
    },
  },
  {
    id: "live-clock-eyebrow",
    category: "copy",
    tell: "A 'LIVE'/'NOW' dot badge and/or the current wall-clock time shown as a UI eyebrow: the device status bar already shows the time, and the live dot is decorative chrome.",
    prevention:
      "Never show the current wall-clock time in UI content: the device status bar already displays it. Never use a 'LIVE'/'NOW' dot badge, with or without a trailing clock. Drop the whole eyebrow.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      findLiveEyebrows(parse(html)).map(
        (el): SlopHit => ({
          ruleId: "live-clock-eyebrow",
          detail: `"${el.text.replace(/\s+/g, " ").trim().slice(0, 24)}"`,
        }),
      ),
    fix: (html) => {
      const root = parse(html)
      const eyebrows = findLiveEyebrows(root)
      if (eyebrows.length === 0) return html
      for (const el of eyebrows) el.remove()
      return root.toString()
    },
  },

  // ---- layout collapse bugs ---------------------------------------------------
  {
    id: "floating-hero-card",
    category: "layout",
    tell: "Decorative 'badge' / 'spec' cards floated over the hero: corner-pinned, backdrop-blurred chips carrying a tiny label that overlap the artwork. A generated-landing signature.",
    prevention:
      "Never float decorative badge / spec cards over a hero or banner: small absolutely / fixed-positioned, corner-pinned chips with a backdrop-blur fill and a tiny label / value. They overlap the artwork and read as generated chrome. Keep hero content in ONE column; if a detail matters, place it inline, not in a floating card.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      findFloatingHeroCards(parse(html), collectClassDecls(html)).map(
        (el): SlopHit => ({
          ruleId: "floating-hero-card",
          detail: `"${el.text.replace(/\s+/g, " ").trim().slice(0, 28)}"`,
        }),
      ),
    fix: (html) => {
      const root = parse(html)
      const cards = findFloatingHeroCards(root, collectClassDecls(html))
      if (cards.length === 0) return html
      for (const el of cards) el.remove()
      return root.toString()
    },
  },
  {
    id: "grid-spacer-void",
    category: "layout",
    tell: "A full-span hairline row divider (grid-column: 1 / -1; height: 1px) placed inside a grid with a fixed grid-auto-rows (e.g. 168px) lands in its own tall track: a 1px line with a ~167px empty band below it, so the screen reads as content rows separated by giant voids.",
    prevention:
      "Never place a full-span divider (grid-column: 1 / -1 with a small fixed height) as a child of a grid that sets a fixed grid-auto-rows / grid-template-rows height: the 1px line is stretched to a whole row, leaving a tall empty band below it. Separate rows with a border-top/border-bottom on the cells themselves, or set grid-auto-rows to auto so each row sizes to its content.",
    tier: "fix",
    severity: 2,
    detect: (html) =>
      [...gridSpacerVoidClasses(html)].map(
        (c): SlopHit => ({
          ruleId: "grid-spacer-void",
          detail: `.${c}: fixed grid-auto-rows with a full-span hairline child`,
        }),
      ),
    fix: (html) => fixGridSpacerVoid(html),
  },
  {
    id: "wrap-padding-collision",
    category: "layout",
    tell: "A section carries the page's inset container class (max-width + margin-inline:auto + padding-inline) but ALSO zeroes its own horizontal padding (a `padding: V 0` shorthand, or padding-left/right:0). At equal specificity the later rule wins, clobbering the container's padding-inline, so the band's content runs flush to the screen edge.",
    prevention:
      "Never set horizontal padding to 0 on an element that also carries the page's inset / `.wrap` container class. Give a section its vertical rhythm with `padding-block` (never `padding: V 0`, padding-left/right:0, or padding-inline:0), so the container's padding-inline survives. If a band is intentionally full-bleed, omit the container class instead of zeroing its padding.",
    tier: "fix",
    severity: 2,
    detect: (html) =>
      [...wrapPaddingCollisionClasses(html)].map(
        (c): SlopHit => ({
          ruleId: "wrap-padding-collision",
          detail: `.${c} zeroes the inset container's horizontal padding`,
        }),
      ),
    fix: (html) => fixWrapPaddingCollision(html),
  },
  {
    id: "body-display-contents",
    category: "layout",
    tell: "display:contents on <body> makes it generate no box: its padding, width, and flex gap are ALL discarded, so the screen renders with no side padding, content under the status bar, and zero section spacing.",
    prevention:
      "Never set display:contents on <body>, inline or via a body{} rule. A boxless body discards its padding and flex gap and the whole screen collapses; body must keep its own box. (display:contents is fine on a nested wrapper <div>, never on body.)",
    tier: "fix",
    severity: 2,
    detect: (html) =>
      Array.from(
        { length: bodyDisplayContentsCount(html) },
        (): SlopHit => ({
          ruleId: "body-display-contents",
          detail: "display:contents on <body> discards its padding and gap",
        }),
      ),
    fix: (html) =>
      bodyDisplayContentsCount(html) > 0 ? stripBodyDisplayContents(html) : html,
  },

  // ---- base polish (additive; absence is not a defect) ------------------------
  {
    id: "hscroll-snap-gutter",
    category: "layout",
    tell: "A horizontal scroll-snap carousel whose side gutter is the container's own inline padding (overflow-x:auto; scroll-snap-type:x mandatory; padding:0 16px) loses that gutter: scroll-snap-align:start rests the first card flush to the edge because the padding sits outside the snapport.",
    prevention:
      "For a horizontal scroll-snap carousel whose side gutter is the container's OWN inline padding (overflow-x:auto with scroll-snap-type:x and padding:0 16px), ALSO set scroll-padding-inline to that same gutter (e.g. scroll-padding-inline:16px). Without it, scroll-snap-align:start under mandatory snap rests the first card flush to the edge, so the first card loses its left spacing and the last card collides with the right edge. Alternatively carry the gutter on the cards with scroll-margin-inline instead of container padding.",
    tier: "base",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: countLeakyHScrollSnap(html) },
        (): SlopHit => ({
          ruleId: "hscroll-snap-gutter",
          detail: "h-scroll snap container insets cards with padding but sets no scroll-padding",
        }),
      ),
    fix: (html) => rewriteCssGroups(html, isLeakyHScrollSnapGroup, addScrollPaddingInline),
  },
  {
    id: "text-wrap-orphans",
    category: "type",
    tell: "Headings ragging unevenly and body copy stranding a one-word orphan on the last line read as unpolished: text-wrap:balance / pretty fix it for free.",
    prevention:
      "Set text-wrap:balance on headings (h1-h3) so line lengths even out and no orphan strands, and text-wrap:pretty on body copy (p, li, figcaption, blockquote) so the last line never leaves a single word alone. Skip both on long passages (10+ lines), code, and <pre>.",
    tier: "base",
    severity: 1,
    detect: (html) =>
      isFullDocument(html) &&
      !hasPolishBlock(html, "gesso-text-wrap") &&
      /<(?:h[1-3]|p|li|figcaption|blockquote)\b/i.test(html)
        ? [{ ruleId: "text-wrap-orphans", detail: "no balance/pretty wrapping" }]
        : [],
    fix: (html) =>
      injectPolishBlock(
        html,
        "gesso-text-wrap",
        "h1,h2,h3{text-wrap:balance}p,li,figcaption,blockquote{text-wrap:pretty}",
      ),
  },
  {
    id: "font-smoothing",
    category: "type",
    tell: "Default macOS text rendering is too heavy; without root antialiasing, type looks bolder than the design intends.",
    prevention:
      "Apply -webkit-font-smoothing:antialiased and -moz-osx-font-smoothing:grayscale ONCE at the root (html). It lightens over-heavy macOS rendering and is safe everywhere (non-macOS ignores it). Never set it per-element.",
    tier: "base",
    severity: 1,
    detect: (html) =>
      isFullDocument(html) && !hasPolishBlock(html, "gesso-font-smoothing")
        ? [{ ruleId: "font-smoothing", detail: "no root font-smoothing" }]
        : [],
    fix: (html) =>
      injectPolishBlock(
        html,
        "gesso-font-smoothing",
        "html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}",
      ),
  },
  {
    id: "image-outline",
    category: "imagery",
    tell: "A photo dropped flush on the surface has no edge: light image regions bleed into light backgrounds and the layout loses its shape.",
    prevention:
      "Define every content image's edge with a 1px inset hairline: outline:1px solid rgba(0,0,0,0.05) on light pages (white at 5% on dark), outline-offset:-1px. Outline, not border, so layout never shifts; pure black/white only, since a tinted edge reads as dirt.",
    tier: "base",
    severity: 1,
    detect: (html) =>
      isFullDocument(html) && !hasPolishBlock(html, "gesso-image-outline") && /<img\b/i.test(html)
        ? [{ ruleId: "image-outline", detail: "images have no inset edge hairline" }]
        : [],
    fix: (html) =>
      isFullDocument(html) && /<img\b/i.test(html)
        ? injectPolishBlock(
            html,
            "gesso-image-outline",
            `img:not([data-illustration]):not([data-icon]):not([aria-hidden="true"]){outline:1px solid ${pageImageOutlineColor(html)};outline-offset:-1px}`,
          )
        : html,
  },

  // ---- print-chrome copy artifacts ------------------------------------------
  // publication-masthead-block MUST run before masthead-eyebrow: the eyebrow
  // rule (element-whole-text) would strip the inner "VOL. 04 / 2024" span
  // first, dropping this block's tell count below threshold and orphaning the
  // rest. Removing the whole container first leaves nothing to nibble.
  {
    id: "publication-masthead-block",
    category: "copy",
    tell: "An invented print-metadata cluster parked at the top of the page: VOLUME 04, CATALOGUE HV-IDX-029, UPDATED 14 MAR. The product has no volume or catalogue; the block exists to look editorial.",
    prevention:
      "Never invent publication metadata. No VOLUME / ISSUE / EDITION / CATALOGUE / SERIAL / UPDATED clusters with made-up numbers, serial codes, or dates: a screen is not a magazine issue.",
    tier: "fix",
    severity: 2,
    detect: (html) =>
      findPublicationMastheadBlocks(parse(html)).map(
        (el): SlopHit => ({
          ruleId: "publication-masthead-block",
          detail: `"${el.text.replace(/\s+/g, " ").trim().slice(0, 32)}"`,
        }),
      ),
    fix: (html) => {
      const root = parse(html)
      const blocks = findPublicationMastheadBlocks(root)
      if (blocks.length === 0) return html
      for (const el of blocks) el.remove()
      return root.toString()
    },
  },
  {
    id: "masthead-eyebrow",
    category: "copy",
    tell: "A lone magazine-issue label ('VOL. 04, № 27', 'ISSUE 12') worn as an eyebrow: borrowed print chrome on a product that ships no issues.",
    prevention:
      "No VOL. / ISSUE / № / EDITION eyebrows. Software has versions and dates, not issues; drop the label entirely.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      findEyebrowMatches(parse(html), MASTHEAD_EYEBROW_TEXT)
        .filter((el) => !elAllows(el, "masthead-eyebrow"))
        .map(
          (el): SlopHit => ({
            ruleId: "masthead-eyebrow",
            detail: `"${el.text.replace(/\s+/g, " ").trim().slice(0, 24)}"`,
          }),
        ),
    fix: (html) => {
      const root = parse(html)
      const hits = findEyebrowMatches(root, MASTHEAD_EYEBROW_TEXT).filter(
        (el) => !elAllows(el, "masthead-eyebrow"),
      )
      if (hits.length === 0) return html
      for (const el of hits) el.remove()
      return root.toString()
    },
  },
  {
    id: "hero-kicker-eyebrow",
    category: "layout",
    tell: "The badge above the H1: a tiny uppercase, letter-spaced kicker restating or locating the headline it sits on. The single most-cited generated-landing tell.",
    prevention:
      "The hero headline stands alone. No uppercase tracked kicker directly above the H1, and no standalone label band before the hero section; if the kicker says anything worth keeping, fold it into the headline or the body. (Section headers above a distinct list further down are fine.)",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      findHeroEyebrows(parse(html), collectClassDecls(html)).map(
        (k): SlopHit => ({
          ruleId: "hero-kicker-eyebrow",
          detail: `"${k.text.replace(/\s+/g, " ").trim().slice(0, 28)}"`,
        }),
      ),
    fix: (html) => fixHeroKicker(html),
  },

  // ---- redundant chrome -------------------------------------------------------
  {
    id: "edge-stripe",
    category: "visual",
    tell: "The colored rail: a thick border-left (or right) accent stripe on cards and rows, usually repeated down the list as ersatz category coding.",
    prevention:
      "No decorative edge stripes: never encode category or status with a >=3px colored border-left/right down a list. Use surface tone, spacing, or a labeled chip. Exception: ONE selected/[aria-selected] row may carry a 3-4px leading accent as its selection state.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: countEdgeStripes(html) },
        (): SlopHit => ({ ruleId: "edge-stripe", detail: "border-left/right >=3px colored rail" }),
      ),
    fix: (html) => fixEdgeStripes(html),
  },
  {
    id: "redundant-border",
    category: "visual",
    tell: "Belt and suspenders: an opaque box border drawn around an element that already separates itself with a background fill.",
    prevention:
      "Fill OR border, never both. A filled card, tile, or button needs no outline; if the fill isn't enough separation, adjust the surface tones instead of boxing it. (Form fields, tables, code blocks, and state borders are exempt; hairlines at <=10% alpha are fine.)",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: countRedundantBorders(html) },
        (): SlopHit => ({ ruleId: "redundant-border", detail: "border on a filled card" }),
      ),
    fix: (html) => fixRedundantBorders(html),
  },

  // ---- headline consistency ---------------------------------------------------
  {
    id: "multicolor-heading",
    category: "color",
    tell: "The two-tone headline: a few words dipped in the accent color while the rest stays neutral, the default move for faking emphasis.",
    prevention:
      "A headline is one ink. Emphasize with weight, size, or a line break, never by recoloring part of the sentence. (Gradient-clipped text has its own guard.)",
    tier: "fix",
    severity: 1,
    sanctionedBy: (_styleRef, ctx) => ctx?.replicate === true,
    detect: (html) =>
      findMulticolorHeadings(parse(html), collectClassDecls(html)).map(
        ({ heading }): SlopHit => ({
          ruleId: "multicolor-heading",
          detail: `"${heading.text.replace(/\s+/g, " ").trim().slice(0, 28)}"`,
        }),
      ),
    fix: (html) => fixMulticolorHeadings(html),
  },
  {
    id: "mixed-style-headline",
    category: "type",
    tell: "The mid-sentence italic swerve: a headline that starts upright and finishes italic (or vice versa) to manufacture sophistication.",
    prevention:
      "A headline keeps one type style end to end. A fully italic headline is a choice; an upright one that turns italic halfway is a tell. Emphasize with weight, size, or a line break.",
    tier: "fix",
    severity: 1,
    sanctionedBy: (_styleRef, ctx) => ctx?.replicate === true,
    detect: (html) =>
      findMixedStyleHeadings(parse(html), collectClassDecls(html)).map(
        ({ heading }): SlopHit => ({
          ruleId: "mixed-style-headline",
          detail: `"${heading.text.replace(/\s+/g, " ").trim().slice(0, 28)}"`,
        }),
      ),
    fix: (html) => fixMixedStyleHeadings(html),
  },

  // ---- over-designed list rows (app-feed genre; advisory on marketing pages) --
  {
    id: "row-kicker-eyebrow",
    category: "layout",
    tell: "List rows wearing eyebrows: every repeated item opens with an ALL-CAPS kicker ('LOCAL FAVORITE · 96 RAVING') before its actual title.",
    prevention:
      "Inside a repeating list row, the title comes first. Status goes in one trailing meta value, not a kicker stacked above the title; save eyebrows for section headers.",
    tier: "flag",
    severity: 2,
    detect: (html) => {
      const root = parse(html)
      const seen = new Set<HTMLElement>()
      const hitsOut: SlopHit[] = []
      for (const rows of repeatingRowSets(root, 2)) {
        const flagged = rows.filter(
          (r) => !seen.has(r) && !elAllows(r, "row-kicker-eyebrow") && rowHasKickerAboveTitle(r),
        )
        if (flagged.length < 2) continue
        for (const r of flagged) {
          seen.add(r)
          hitsOut.push({
            ruleId: "row-kicker-eyebrow",
            detail: `"${(textRuns(r)[0] ?? "").slice(0, 24)}"`,
          })
        }
      }
      return hitsOut
    },
  },
  {
    id: "multiline-row-meta",
    category: "layout",
    tell: "A review quote or description wrapping to two-plus lines inside a repeating row, snapping the list's vertical rhythm against its single-line neighbors.",
    prevention:
      "Meta inside a repeating row is one line. Truncate with text-overflow: ellipsis or push the quote to the detail screen; a wrapping pull-quote does not belong in a list cell.",
    tier: "flag",
    severity: 2,
    detect: (html) => {
      const root = parse(html)
      const seen = new Set<HTMLElement>()
      const hitsOut: SlopHit[] = []
      for (const rows of repeatingRowSets(root, 2)) {
        for (const r of rows) {
          if (seen.has(r) || elAllows(r, "multiline-row-meta") || !rowHasMultilineMeta(r)) continue
          seen.add(r)
          hitsOut.push({ ruleId: "multiline-row-meta", detail: "wrapping quote/meta in a list row" })
        }
      }
      return hitsOut
    },
  },
  {
    id: "overstuffed-row",
    category: "layout",
    tell: "The everything-row: thumbnail plus kicker plus title plus location plus quote plus mini-viz crammed into each repeated item, past any scannable density.",
    prevention:
      "Budget a repeating row at three info slots: subject or thumbnail, title, one decision metric. Everything else lives on the detail screen.",
    tier: "flag",
    severity: 2,
    detect: (html) => {
      const root = parse(html)
      const seen = new Set<HTMLElement>()
      const hitsOut: SlopHit[] = []
      for (const rows of repeatingRowSets(root, 2)) {
        const over = rows.filter(
          (r) =>
            !seen.has(r) && !elAllows(r, "overstuffed-row") && rowInfoSlots(r) > OVERSTUFFED_SLOT_CAP,
        )
        if (over.length < 2) continue
        for (const r of over) {
          seen.add(r)
          hitsOut.push({ ruleId: "overstuffed-row", detail: `${rowInfoSlots(r)} slots in one row` })
        }
      }
      return hitsOut
    },
  },
  {
    id: "row-as-card",
    category: "layout",
    tell: "Card-itis: a plain text feed where every uniform row gets its own border, radius, and elevation, floating on gaps instead of sitting in a list.",
    prevention:
      "Uniform text-led items (transactions, messages, check-ins) read as bare rows with 1px dividers. Spend per-item cards only on genuinely rich tiles, a photo with a price and rating, not on a repeated one-liner.",
    tier: "flag",
    severity: 1,
    detect: (html) => {
      const root = parse(html)
      const classMap = collectClassDecls(html)
      return findRowCards(root, classMap).map(
        (set): SlopHit => ({ ruleId: "row-as-card", detail: `${set.length} text-rows styled as cards` }),
      )
    },
  },

  // ---- layout collapse + perf -------------------------------------------------
  {
    id: "reveal-specificity-trap",
    category: "layout",
    tell: "Scroll-reveal CSS where the hidden rule (`html.js .reveal`, 0-2-1) permanently outranks the revealed rule (`.reveal.in`, 0-2-0): the observer adds the class, the cascade ignores it, and everything below the hero stays invisible.",
    prevention:
      "Gate the revealed state exactly like the hidden one. If `html.js .reveal { opacity: 0 }` hides, then `html.js .reveal.in { opacity: 1 }` reveals; a bare `.reveal.in` loses the specificity contest and the section never appears.",
    tier: "fix",
    severity: 3,
    detect: (html) => findRevealSpecificityTraps(html).hits,
    fix: (html) => findRevealSpecificityTraps(html).fixedHtml,
  },
  {
    id: "will-change-misuse",
    category: "motion",
    tell: "will-change pointed at layout or paint properties (top, width, background, box-shadow) or at `all`: it buys a GPU layer that can never help those props, pure memory cost.",
    prevention:
      "will-change earns its layer only on compositable properties: transform, opacity, filter, clip-path. Never `will-change: all`, never layout/paint props, and only where first-frame stutter is actually observed.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: countWillChangeMisuse(html) },
        (): SlopHit => ({
          ruleId: "will-change-misuse",
          detail: "will-change on a non-compositable property",
        }),
      ),
    fix: (html) => fixWillChange(html),
  },

  // ---- fingerprint colors beyond indigo ---------------------------------------
  // dark-glow runs BEFORE purple-violet-wash so a violet glow is dropped as a
  // glow layer rather than having its color routed to the accent token.
  {
    id: "dark-glow",
    category: "visual",
    tell: "Neon under the furniture: wide, saturated box/text shadows glowing behind cards and buttons, the default 'premium dark SaaS' move.",
    prevention:
      "Shadows are for depth, not light. Never give an element a saturated colored glow (a wide-blur box-shadow/text-shadow or drop-shadow in a vivid color); on dark surfaces separate with surface tone and hairlines instead.",
    tier: "fix",
    severity: 2,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, (d) => countDarkGlow(d) > 0) },
        (): SlopHit => ({ ruleId: "dark-glow", detail: "saturated wide-blur glow shadow" }),
      ),
    fix: (html) => rewriteCssGroups(html, (d) => countDarkGlow(d) > 0, stripDarkGlow),
  },
  {
    id: "purple-violet-wash",
    category: "color",
    tell: "Saturated purple/violet doing accent duty: the wider band behind the indigo hex list, and the single most recognized generated-UI color story.",
    prevention:
      "Treat the whole saturated violet band (hue ~252-296) as radioactive unless the brand genuinely owns it. When no accent was chosen, defer to the page's accent token instead of reaching for purple.",
    tier: "fix",
    severity: 1,
    sanctionedBy: (_styleRef, ctx) => ctx?.replicate === true,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasVioletWash) },
        (): SlopHit => ({ ruleId: "purple-violet-wash", detail: "saturated violet-band color" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupHasVioletWash, fixVioletGroup),
  },
  {
    id: "safe-green-default",
    category: "color",
    tell: "Tailwind emerald as the fallback personality: the accent models retreat to once purple is denied, the second-order version of the same non-choice.",
    prevention:
      "Emerald green is not a default. If the brand did not pick green, do not let 'not purple' resolve to #10b981; choose an accent that belongs to the subject.",
    tier: "flag",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasSafeGreen) },
        (): SlopHit => ({ ruleId: "safe-green-default", detail: "Tailwind emerald accent hex" }),
      ),
  },
  {
    id: "cream-default-wash",
    category: "color",
    tell: "The cream-and-serif costume: a warm off-white ground plus serif display type, worn by default as 'tasteful' regardless of what the product is.",
    prevention:
      "Cream ground + serif display is an editorial voice, not a neutral default. Reach for it when the brief is editorial; otherwise pick a ground and voice that come from the subject.",
    tier: "flag",
    severity: 1,
    detect: (html) => {
      const bg = pageBackgroundHSL(html)
      const creamy =
        !!bg && bg.h >= 25 && bg.h <= 60 && bg.s >= 0.1 && bg.s <= 0.5 && bg.l >= 0.82
      return creamy && pageHasSerifDisplay(html)
        ? [{ ruleId: "cream-default-wash", detail: "cream ground + serif display voice" }]
        : []
    },
  },

  // ---- type hygiene -------------------------------------------------------------
  {
    id: "overused-font-stack",
    category: "type",
    tell: "The four display faces every AI-tell list names: Inter, Space Grotesk, Geist, Instrument Serif. Fine fonts, exhausted defaults.",
    prevention:
      "Do not default to Inter, Space Grotesk, Geist, or Instrument Serif for display type. Pick a face that argues for the subject; if a neutral grotesque is genuinely right, make it a choice, not a reflex.",
    tier: "flag",
    severity: 1,
    detect: (html) =>
      findOverusedFonts(html).map(
        (f): SlopHit => ({ ruleId: "overused-font-stack", detail: f }),
      ),
  },
  {
    id: "single-font-page",
    category: "type",
    tell: "One family carrying the entire page: no pairing, no contrast of voice between display and body.",
    prevention:
      "Give display and body distinct voices: a deliberate pairing, or at minimum distinct optical weights/widths of one family used with intent. A page set entirely in one face at one register reads as unstyled.",
    tier: "flag",
    severity: 1,
    detect: (html) => {
      if (!isFullDocument(html)) return []
      const fams = declaredFamilies(html)
      return fams.length === 1
        ? [{ ruleId: "single-font-page", detail: `only "${fams[0]}" declared` }]
        : []
    },
  },
  {
    id: "crushed-tracking",
    category: "type",
    tell: "Display tracking crushed past legibility (letter-spacing at -0.05em or tighter), the 'make it look designed' knob turned into a wall.",
    prevention:
      "Tighten display type with restraint: letter-spacing tighter than about -0.04em starts welding glyphs together. Large sizes rarely need more than -0.02em.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasCrushedTracking) },
        (): SlopHit => ({ ruleId: "crushed-tracking", detail: "letter-spacing <= -0.05em" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupHasCrushedTracking, fixCrushedTracking),
  },
  {
    id: "wide-body-tracking",
    category: "type",
    tell: "Body-size text tracked out to 0.08em+ without the uppercase that would justify it: airy-looking, exhausting to read.",
    prevention:
      "Wide letter-spacing belongs to short uppercase labels. Mixed-case body and UI text reads best at its natural tracking; past ~0.05em word shapes fall apart.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasWideBodyTracking) },
        (): SlopHit => ({ ruleId: "wide-body-tracking", detail: "letter-spacing >= 0.08em on mixed-case text" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupHasWideBodyTracking, fixWideBodyTracking),
  },
  {
    id: "tight-line-height",
    category: "type",
    tell: "Body-size text with line-height under 1.25: lines shingled on top of each other in the name of density.",
    prevention:
      "Body copy needs air: line-height 1.4-1.6 at text sizes (13-20px). Reserve tight leading for display sizes that set their own rules.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasTightLineHeight) },
        (): SlopHit => ({ ruleId: "tight-line-height", detail: "line-height < 1.25 at body size" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupHasTightLineHeight, fixTightLineHeight),
  },
  {
    id: "tiny-body-text",
    category: "type",
    tell: "Text under 11px pretending to be readable: below the floor of high-DPI legibility for anything that is not a tracked micro-label.",
    prevention:
      "12px is the floor for readable text. Under it, only short uppercase micro-labels survive, and only barely; body copy and UI labels never go there.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupHasTinyBodyText) },
        (): SlopHit => ({ ruleId: "tiny-body-text", detail: "font-size < 11px on mixed-case text" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupHasTinyBodyText, fixTinyBodyText),
  },
  {
    id: "monospace-body",
    category: "type",
    tell: "Prose set in a code font: body or paragraph rules pointing at monospace, cosplaying a terminal instead of setting readable text.",
    prevention:
      "Monospace is for code, data, and deliberate technical accents, never for body prose. Set paragraphs in a text face; quote code in <code>.",
    tier: "flag",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: countMonospaceBody(html) },
        (): SlopHit => ({ ruleId: "monospace-body", detail: "body/p rule with a monospace family" }),
      ),
  },

  // ---- blob + ghost + template structures ---------------------------------------
  {
    id: "over-rounded-card",
    category: "visual",
    tell: "Cards rounded into blobs: 40px+ radii on filled content surfaces, the 'friendly' dial turned past its stop.",
    prevention:
      "Content cards hold their shape: radius 8-24px. Reserve larger rounding for pills (which use full rounding deliberately) and standalone organic shapes, not for text-bearing surfaces.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupIsOverRounded) },
        (): SlopHit => ({ ruleId: "over-rounded-card", detail: "border-radius >= 40px on a filled card" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupIsOverRounded, fixOverRounded),
  },
  {
    id: "ghost-card",
    category: "visual",
    tell: "The ghost card: a hairline border AND a wide soft halo shadow on the same surface, hedging between two separation strategies.",
    prevention:
      "Pick the card's separation: a hairline border OR a soft shadow, not both. The doubled treatment reads as floaty and indecisive.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, groupIsGhostCard) },
        (): SlopHit => ({ ruleId: "ghost-card", detail: "hairline border + wide soft shadow" }),
      ),
    fix: (html) => rewriteCssGroups(html, groupIsGhostCard, stripGhostShadow),
  },
  {
    id: "nested-cards",
    category: "layout",
    tell: "Cards inside cards: surfaced containers stacked so every level carries its own radius, fill, and edge, and depth stops meaning anything.",
    prevention:
      "One card level per region. Inside a card, group content with spacing and rules, not with another card; chips and badges are fine, surfaced sub-containers are not.",
    tier: "gate",
    severity: 1,
    detect: (html) =>
      findNestedCards(parse(html), collectClassDecls(html)).map(
        (el): SlopHit => ({
          ruleId: "nested-cards",
          detail: `card container nested in a card ("${el.text.replace(/\s+/g, " ").trim().slice(0, 24)}")`,
        }),
      ),
  },
  {
    id: "numbered-section-markers",
    category: "layout",
    tell: "Decorative 01 / 02 / 03 scaffolding: leading-zero index labels stamped on sections whose order encodes nothing.",
    prevention:
      "Number sections only when order is the content (steps, a timeline, ranked results). Leading-zero markers as decoration are template scaffolding left showing.",
    tier: "flag",
    severity: 1,
    detect: (html) =>
      findNumberedMarkers(parse(html)).map(
        (el): SlopHit => ({
          ruleId: "numbered-section-markers",
          detail: `"${el.text.replace(/\s+/g, " ").trim()}"`,
        }),
      ),
  },
  {
    id: "icon-topped-feature-card",
    category: "layout",
    tell: "The universal feature-card template: icon on top, heading, blurb, times three, the single most recycled section structure in generated landings.",
    prevention:
      "If a features section must exist, earn its structure: vary the geometry, lead with evidence (a screenshot, a number, a demo), or write one strong paragraph. Icon-heading-blurb x3 is the template every generator emits.",
    tier: "flag",
    severity: 1,
    detect: (html) =>
      findIconToppedCardSets(parse(html)).map(
        (set): SlopHit => ({
          ruleId: "icon-topped-feature-card",
          detail: `${set.length} icon-topped cards in a row`,
        }),
      ),
  },

  // ---- motion tells ---------------------------------------------------------------
  {
    id: "bounce-easing",
    category: "motion",
    tell: "Entrance overshoot: cubic-bezier curves that spring past their target, making dialogs and cards wobble in like toys.",
    prevention:
      "Ease out, land once. No overshoot/elastic easing (cubic-bezier with y-values outside 0-1) on UI motion; interfaces settle, they do not bounce.",
    tier: "fix",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: eachStyleAndInline(html, (d) => countBounceEasing(d) > 0) },
        (): SlopHit => ({ ruleId: "bounce-easing", detail: "overshoot cubic-bezier" }),
      ),
    fix: (html) => rewriteCssGroups(html, (d) => countBounceEasing(d) > 0, fixBounceEasing),
  },
  {
    id: "layout-prop-animation",
    category: "motion",
    tell: "Transitions on layout properties (width/height/top/left/margin/padding): every frame reflows the page, and the motion stutters exactly where it wants to impress.",
    prevention:
      "Animate transforms and opacity, not layout. Move with translate, scale with transform, reveal with opacity/clip-path; for expanding panels prefer grid-template-rows or measured transforms over height transitions.",
    tier: "gate",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: countLayoutPropTransitions(html) },
        (): SlopHit => ({ ruleId: "layout-prop-animation", detail: "transition on a layout property" }),
      ),
  },
  {
    id: "hover-scale-image",
    category: "motion",
    tell: "The reflex zoom: transform scale on image/card hover, applied to everything because it is the one hover effect everyone has seen.",
    prevention:
      "Hover states should inform (affordance, elevation, focus), not inflate. If an image hover must move, keep it under 1.03 and pair it with a reason; better, respond with overlay or caption instead of scale.",
    tier: "flag",
    severity: 1,
    detect: (html) =>
      Array.from(
        { length: countHoverScaleImage(html) },
        (): SlopHit => ({ ruleId: "hover-scale-image", detail: "scale() on image hover" }),
      ),
  },

  // ---- UI microcopy ----------------------------------------------------------------
  {
    id: "benefit-speak",
    category: "copy",
    tell: "Marketing verbs that sell nothing specific: Elevate, Supercharge, Seamlessly, Empower, Unlock your... the vocabulary of copy written by no one about nothing.",
    prevention:
      "Say what the product does with concrete verbs and objects ('Search your meeting notes', not 'Unlock your knowledge'). Elevate/supercharge/streamline/empower/seamless/effortless/world-class are placeholders for a claim, not claims.",
    tier: "gate",
    severity: 1,
    detect: (html) => {
      const hits: SlopHit[] = []
      for (const run of visibleTextRuns(html)) {
        for (const m of run.matchAll(BENEFIT_SPEAK_RE)) {
          hits.push({ ruleId: "benefit-speak", detail: `"${m[0]}"` })
        }
      }
      return hits
    },
  },
  {
    id: "not-x-but-y-cadence",
    category: "copy",
    tell: "The manufactured-rebuttal cadence: \"It's not just X, it's Y\", contrast written as a tic rather than an argument.",
    prevention:
      "Make the claim directly. The 'not X, it's Y' construction is the most recognized generated-copy rhythm there is; if the contrast matters, show the difference with specifics.",
    tier: "flag",
    severity: 1,
    detect: (html) =>
      visibleTextRuns(html)
        .filter((run) => NOT_X_BUT_Y_RE.test(run))
        .map((run): SlopHit => ({
          ruleId: "not-x-but-y-cadence",
          detail: `"${run.slice(0, 48)}"`,
        })),
  },
  {
    id: "fabricated-precision",
    category: "copy",
    tell: "Numbers nobody measured: 99.9% uptime, 10x faster, #1 platform, trusted by thousands, precision invented to look like evidence.",
    prevention:
      "Use real numbers with real sources, or none. 99.9%/10x/#1/'trusted by thousands' without attribution are recognized filler stats; a screen is more credible with one true number than four invented ones.",
    tier: "flag",
    severity: 1,
    detect: (html) => {
      const hits: SlopHit[] = []
      for (const run of visibleTextRuns(html)) {
        for (const m of run.matchAll(FABRICATED_PRECISION_RE)) {
          hits.push({ ruleId: "fabricated-precision", detail: `"${m[0]}"` })
        }
      }
      return hits
    },
  },
  {
    id: "apologetic-error-copy",
    category: "copy",
    tell: "\"Oops! Something went wrong\": the error message that apologizes instead of helping, shipped verbatim by every template.",
    prevention:
      "Errors are guidance: name what failed and the next step ('Couldn't save. Check your connection and retry.'). Never 'Oops', 'Whoops', 'Uh oh', or a bare 'Something went wrong'.",
    tier: "gate",
    severity: 1,
    detect: (html) => {
      const hits: SlopHit[] = []
      for (const run of visibleTextRuns(html)) {
        for (const m of run.matchAll(APOLOGETIC_ERROR_RE)) {
          hits.push({ ruleId: "apologetic-error-copy", detail: `"${m[0]}"` })
        }
      }
      return hits
    },
  },
]
