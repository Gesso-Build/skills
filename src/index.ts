// @gessobuild/anti-slop: deterministic AI-slop detection and fixing for
// generated HTML/CSS.
//
//   import { runSlopGuard, applySlopFixes, FLAGSHIP_RULES } from "@gessobuild/anti-slop"
//
//   const check = runSlopGuard(html, {}, FLAGSHIP_RULES)   // detect
//   const fixed = applySlopFixes(html, {}, FLAGSHIP_RULES) // rewrite
//
// The engine is generic over the rule context, so hosts can register their
// own rules with richer style/token types alongside (or instead of) the
// flagship registry.

export {
  applySlopFixes,
  buildSlopConstraintsBlock,
  buildSlopCorrectionPrompt,
  PER_RULE_SEVERITY_CAP,
  runSlopGuard,
} from "./engine.js"
export { FLAGSHIP_RULES } from "./rules.js"
export type {
  SlopCategory,
  SlopCheck,
  SlopCtx,
  SlopCtxLike,
  SlopFixResult,
  SlopHit,
  SlopRule,
  SlopStyleHints,
  SlopTier,
} from "./types.js"
