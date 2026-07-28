// Anti-slop: shared types.
//
// A "slop rule" is one source of truth for three artifacts:
//   - `prevention`: a negative constraint to inject into a generation prompt,
//   - `detect`: a post-generation detector over the HTML string,
//   - `fix` (optional): a deterministic, idempotent, design-preserving rewrite.
//
// The engine (./engine) is generic over the rule context, so a host can
// thread its own richer context (style-system objects, design tokens)
// through detect/fix/sanctionedBy without this package knowing about them.

/**
 * How a rule is enforced.
 * - "fix":  deterministic rewrite of a DEFECT, applied on every path. Must be
 *           design-preserving and idempotent. Hits count toward pass/severity.
 * - "base": deterministic ADDITIVE injection of a base-style default. Its
 *           absence is NOT a defect, so runSlopGuard excludes it from
 *           pass/severity/issues; only applySlopFixes consumes its detect().
 * - "gate": contributes `severity` to a retry comparator so the model
 *           regenerates. For structural slop a regex cannot safely rewrite.
 * - "flag": advisory only; logged for telemetry, never blocks.
 */
export type SlopTier = "fix" | "base" | "gate" | "flag"

export type SlopCategory =
  | "visual"
  | "type"
  | "color"
  | "layout"
  | "motion"
  | "copy"
  | "imagery"
  | "quality"

/** One detected occurrence of a slop rule. */
export interface SlopHit {
  ruleId: string
  /** Human-readable specifics (a value, selector, or excerpt) for logs. */
  detail: string
}

/**
 * The minimal context shape the engine needs. Hosts extend this with their
 * own style/token types; the engine only threads it through.
 */
export interface SlopCtxLike {
  /** The active style reference, consulted by sanctionedBy(). */
  styleRef?: unknown
  /** Design tokens, for picking safe replacement values in fixes. */
  tokens?: unknown
  /**
   * Replication mode: when faithfully reproducing a reference whose hero
   * legitimately uses an expressive treatment (gradient headline), rules
   * that would strip it are sanctioned.
   */
  replicate?: boolean
}

/** The context shape this package's own flagship rules consume. */
export interface SlopCtx extends SlopCtxLike {
  styleRef?: SlopStyleHints
  tokens?: Record<string, unknown>
}

/** Structural hints a flagship rule may read off a host's style reference. */
export interface SlopStyleHints {
  /** Stable style id (e.g. "swiss", "brutalist-bold"). */
  id?: string
}

export interface SlopRule<Ctx extends SlopCtxLike = SlopCtx> {
  /** Stable kebab-case id, e.g. "gradient-text". */
  id: string
  category: SlopCategory
  /** The tell: why this pattern reads as generated-UI slop. */
  tell: string
  /** Negative constraint injected into the system prompt (prevention side). */
  prevention: string
  tier: SlopTier
  /** Per-occurrence severity weight (capped per-rule in runSlopGuard). */
  severity: number
  /** Detect occurrences. Pure; the engine also wraps it in try/catch. */
  detect: (html: string, ctx: Ctx) => SlopHit[]
  /** Deterministic rewrite. Required for tier "fix"; must be idempotent. */
  fix?: (html: string, ctx: Ctx) => string
  /**
   * Style-awareness. Return true when the active style legitimately mandates
   * this pattern, so the guard skips it instead of fighting the design system.
   */
  sanctionedBy?: (styleRef: Ctx["styleRef"], ctx?: Ctx) => boolean
}

export interface SlopCheck {
  pass: boolean
  issues: string[]
  /** Numeric severity for a unified retry comparator. */
  severity: number
  counts: {
    /** Hit count per rule id (non-zero entries only). */
    byRule: Record<string, number>
    total: number
  }
}

export interface SlopFixResult {
  html: string
  /** Occurrences fixed per rule id (non-zero entries only). */
  fixes: Record<string, number>
  total: number
}
