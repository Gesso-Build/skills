// Anti-slop: engine.
//
// Three generic operations over a rule registry:
//   - runSlopGuard:              detect -> { pass, issues, severity, counts }
//   - applySlopFixes:            run every FIX/BASE rule's deterministic rewrite
//   - buildSlopConstraintsBlock: render the prevention text for a prompt
//
// Every rule call is wrapped in try/catch: a buggy regex must never break a
// live generation; it degrades to "no hits" / "no fix".

import type {
  SlopCheck,
  SlopCtxLike,
  SlopFixResult,
  SlopRule,
} from "./types.js"

/** Per-rule severity is capped so one runaway pattern can't dwarf the others. */
export const PER_RULE_SEVERITY_CAP = 4

// Hit details quote evidence from the scanned document, which is untrusted
// input that ends up embedded in reports, agent context, and retry prompts.
// Bound what an author of a hostile document can smuggle through: collapse
// control characters and newlines, and cap the excerpt length.
const DETAIL_MAX_LENGTH = 80

function sanitizeDetail(detail: string): string {
  const flat = detail
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
  return flat.length > DETAIL_MAX_LENGTH
    ? `${flat.slice(0, DETAIL_MAX_LENGTH)}...`
    : flat
}

// A document that links stylesheets it does not inline gives the style-
// dependent rules partial input, so its verdict is a lower bound. Font-service
// hosts only deliver @font-face and do not count against completeness.
const FONT_SERVICE_RE =
  /fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.bunny\.net|use\.typekit\.(?:net|com)|api\.fontshare\.com|fonts\.cdnfonts\.com/i

function countExternalStylesheets(html: string): number {
  let count = 0
  for (const link of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = link[0]
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1] ?? ""
    if (!href || href.startsWith("data:") || FONT_SERVICE_RE.test(href)) continue
    count++
  }
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const body = style[1] ?? ""
    for (const imp of body.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
      const href = imp[1] ?? ""
      if (!href || href.startsWith("data:") || FONT_SERVICE_RE.test(href)) continue
      count++
    }
  }
  return count
}

function isSanctioned<Ctx extends SlopCtxLike>(
  rule: SlopRule<Ctx>,
  ctx: Ctx,
): boolean {
  try {
    return rule.sanctionedBy?.(ctx.styleRef, ctx) ?? false
  } catch {
    return false
  }
}

function activeRules<Ctx extends SlopCtxLike>(
  ctx: Ctx,
  rules: SlopRule<Ctx>[],
): SlopRule<Ctx>[] {
  return rules.filter((r) => !isSanctioned(r, ctx))
}

/**
 * Detect slop in generated HTML. Severity-scored for a retry comparator;
 * style-aware via each rule's sanctionedBy().
 */
export function runSlopGuard<Ctx extends SlopCtxLike>(
  html: string,
  ctx: Ctx,
  rules: SlopRule<Ctx>[],
): SlopCheck {
  const issues: string[] = []
  const byRule: Record<string, number> = {}
  let severity = 0
  let gatingTotal = 0
  let advisoryTotal = 0

  for (const rule of activeRules(ctx, rules)) {
    // "base" rules inject a base-style default; their absence is not a defect,
    // so they never count toward pass/severity/issues (only applySlopFixes
    // consumes their detect()).
    if (rule.tier === "base") continue
    let hits: ReturnType<SlopRule<Ctx>["detect"]>
    try {
      hits = rule.detect(html, ctx)
    } catch {
      hits = []
    }
    if (hits.length === 0) continue
    byRule[rule.id] = hits.length
    // "flag" rules are advisory by contract (see SlopTier): they are reported
    // in issues and counted in byRule for telemetry, but they never gate the
    // verdict or feed the retry comparator's severity.
    const advisory = rule.tier === "flag"
    if (advisory) {
      advisoryTotal += hits.length
    } else {
      gatingTotal += hits.length
      severity += Math.min(PER_RULE_SEVERITY_CAP, hits.length * rule.severity)
    }
    const examples = hits.slice(0, 3).map((h) => sanitizeDetail(h.detail))
    issues.push(
      `[${rule.category}/${rule.id}]${advisory ? " [advisory]" : ""} ${hits.length}x: ${rule.tell}` +
        (examples.length > 0 ? ` (e.g. ${examples.join("; ")})` : ""),
    )
  }

  const total = Object.values(byRule).reduce((a, b) => a + b, 0)
  let externalStylesheets = 0
  try {
    externalStylesheets = countExternalStylesheets(html)
  } catch {
    externalStylesheets = 0
  }
  return {
    pass: gatingTotal === 0,
    issues,
    severity,
    counts: { byRule, total, gating: gatingTotal, advisory: advisoryTotal },
    externalStylesheets,
  }
}

/**
 * Apply every FIX/BASE-tier rule's deterministic rewrite. Idempotent:
 * re-running on already-clean HTML is a no-op. A fixer that throws leaves
 * the HTML untouched (a guard must never break generation).
 */
export function applySlopFixes<Ctx extends SlopCtxLike>(
  html: string,
  ctx: Ctx,
  rules: SlopRule<Ctx>[],
): SlopFixResult {
  let working = html
  const fixes: Record<string, number> = {}

  for (const rule of activeRules(ctx, rules)) {
    if ((rule.tier !== "fix" && rule.tier !== "base") || !rule.fix) continue
    let before = 0
    try {
      before = rule.detect(working, ctx).length
    } catch {
      before = 0
    }
    if (before === 0) continue
    try {
      const next = rule.fix(working, ctx)
      if (next !== working) {
        working = next
        fixes[rule.id] = before
      }
    } catch {
      // Leave the HTML as-is on any fixer error.
    }
  }

  const total = Object.values(fixes).reduce((a, b) => a + b, 0)
  return { html: working, fixes, total }
}

/**
 * Render the prevention block for a system prompt. Drops rules the active
 * style legitimately sanctions, so the prompt never contradicts the style
 * reference.
 */
export function buildSlopConstraintsBlock<Ctx extends SlopCtxLike>(
  styleRef: Ctx["styleRef"] | undefined,
  rules: SlopRule<Ctx>[],
): string {
  const active = rules.filter(
    (r) => !isSanctioned(r, { styleRef } as Ctx),
  )
  const byCat = new Map<string, string[]>()
  for (const r of active) {
    const arr = byCat.get(r.category) ?? []
    arr.push(`- ${r.prevention}`)
    byCat.set(r.category, arr)
  }
  const sections = [...byCat.entries()].map(
    ([cat, lines]) => `${cat.toUpperCase()}:\n${lines.join("\n")}`,
  )
  return [
    "AI-SLOP GUARD (these patterns are auto-detected/auto-fixed after generation, avoid them up front):",
    ...sections,
  ].join("\n\n")
}

/** Corrective message for a retry path. */
export function buildSlopCorrectionPrompt(check: SlopCheck): string {
  return [
    "Your previous output tripped the AI-slop guard:",
    ...check.issues.map((i) => `- ${i}`),
    "",
    "Re-emit the screen with these patterns removed. Keep every other design decision intact.",
  ].join("\n")
}
