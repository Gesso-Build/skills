# @gessobuild/anti-slop

A deterministic design critique for HTML/CSS, extracted from the set of
rules professional designers use in production-grade designs.

"Slop" is the set of visual tells that make generated UI read as generated:
the gradient-clipped headline, the indigo accent nobody chose, the puffy
stacked drop-shadow, the emoji standing in for an icon system, the row of
equal dots faking a chart, the badge card floated over the hero, the em
dash mid-sentence, the `$1,842,000` figure no designer would typeset raw.
This package holds 73 of those tells as executable rules: each one a
documented detector with an exact threshold, most with a deterministic,
idempotent, design-preserving auto-fix. Simple tells are regex-level;
structural tells are found by parsing the markup (never executing it).

The detector reads `.html` files (inline styles and `<style>` blocks):
exports, prototypes, static builds, generated screens. It does not parse
JSX/TSX source; render or export to HTML first, then check the output.

# Install

```bash
npx -y @gessobuild/anti-slop install
```

# Use

```
/gesso-critique page.html
```

That one command is the whole loop: the deterministic verdict with
evidence, the auto-fixes on request, then a clearly-labeled second
opinion. You can also just ask ("check this for slop", "second opinion
on this screen"), and the installed skill runs the check on its own
before the agent shows, ships, or commits HTML/CSS.

The install copies the skill and the command into the current project's
`.claude/`, git-reviewable (`--global` targets `~/.claude/` instead).
Everything you install is committed here word for word:
[SKILL.md](skills/anti-slop/SKILL.md),
[rules.md](skills/anti-slop/references/rules.md),
[critique.md](commands/critique.md).

## Other ways to install

On another agent (Codex, Cursor, Amp, and friends), install through the
[skills CLI](https://www.skills.sh/gesso-build/skills/anti-slop); there
is no slash command there, so trigger it by asking for a slop check or
critique:

```bash
npx skills add Gesso-Build/skills
```

Claude Code users can install the plugin instead. Note the plugin spells
the command `/gesso:critique` (colon, not hyphen):

```
/plugin marketplace add Gesso-Build/skills
/plugin install gesso@gesso
```

## CLI

Nothing to install for one-off checks and CI:

```bash
npx -y @gessobuild/anti-slop check page.html        # verdict + tells; exit 1 on slop
npx -y @gessobuild/anti-slop check dist/ --json     # machine-readable, whole tree
npx -y @gessobuild/anti-slop fix page.html --write  # apply the deterministic fixes
```

`check` exits 0 on clean, 1 on slop, 2 on usage errors, so a CI step is one
line (see [Wiring it into CI](skills/anti-slop/SKILL.md#wiring-it-into-ci)).
Advisory (FLAG-tier) hits are reported for context but never affect the
verdict or the exit code. `fix` is idempotent: running it twice is a no-op.

A failing check prints `SLOP (severity N, M advisory)`: severity is a
weighted sum of distinct gating tells, capped at 4 per rule so one runaway
pattern cannot drown the rest, and the advisory count is the genre-dependent
context that never gates. Read severity 1-2 as an isolated tell, 3-6 as a
pattern with a shared cause, and 7+ as template-grade slop that needs design
attention beyond the fixes; those bands are calibrated for a single screen,
so compare longer documents on severity plus the advisory count together,
never severity alone. A `pass` is stricter than a low score: it means zero
FIX/GATE hits. When a document links external stylesheets it does not
inline, the check says so and every style-dependent result is a lower
bound.

## The 73 guards

FIX rules are auto-fixable; GATE rules are detect-only because the right
fix needs a decision the tool refuses to fake (which properties to animate,
what the copy should say, which real image to use); FLAG rules are advisory
and never affect the verdict, because their tell is genre-dependent (an
over-designed list row is a defect on an app feed but the genre on a
marketing page); BASE rules are additive polish whose absence is not a
defect (they never affect the verdict; `fix` injects the default once,
idempotently). Every guard's exact detection condition, rationale, and
before/after pair is documented in
[skills/anti-slop/references/rules.md](skills/anti-slop/references/rules.md).

| Guard | Category | Tier | Catches |
| --- | --- | --- | --- |
| `gradient-text` | color | FIX | gradient clipped into headline text |
| `indigo-accent` | color | FIX | the default Tailwind indigo/violet accent |
| `gradient-fill` | color | FIX | a gradient fill on a rounded tile/card/chip/button |
| `multicolor-fill` | color | FIX | multi-hue entity fills (pink-to-purple tiles) |
| `multicolor-heading` | color | FIX | two-tone headlines (accent-dipped words) |
| `purple-violet-wash` | color | FIX | the wider saturated violet band behind the indigo list |
| `safe-green-default` | color | FLAG | Tailwind emerald as the escape-hatch accent |
| `cream-default-wash` | color | FLAG | the cream ground + serif display costume |
| `hollow-text` | type | FIX | outlined letterforms via text-stroke + transparent fill |
| `underlined-text` | type | FIX | underlines on UI text and links |
| `all-caps-body` | type | FIX | uppercase body passages over 60 characters |
| `emoji-icon` | type | FIX | a leading emoji used as an icon glyph |
| `mixed-style-headline` | type | FIX | headlines swerving from upright into italic |
| `overused-font-stack` | type | FLAG | Inter / Space Grotesk / Geist / Instrument Serif defaults |
| `single-font-page` | type | FLAG | one family carrying the whole page |
| `crushed-tracking` | type | FIX | display tracking at -0.05em or tighter |
| `wide-body-tracking` | type | FIX | 0.08em+ tracking on mixed-case text |
| `tight-line-height` | type | FIX | body-size text with line-height under 1.25 |
| `tiny-body-text` | type | FIX | mixed-case text under 11px |
| `monospace-body` | type | FLAG | prose set in a code font |
| `text-wrap-orphans` | type | BASE | headings/copy without balance/pretty wrapping |
| `font-smoothing` | type | BASE | no root antialiasing (over-heavy macOS type) |
| `heavy-box-shadow` | visual | FIX | stacked or high-alpha "puffy card" shadows |
| `gradient-border` | visual | FIX | gradient rings around avatars/cards |
| `bare-hr` | visual | FIX | full-opacity 3D `<hr>` dividers |
| `decorative-divider` | visual | FIX | box-drawing or dash runs used as chrome |
| `repeating-gradient-stripe` | visual | FIX | repeating-gradient stripes as surface decoration |
| `fake-dot-viz` | visual | FIX | equal dot/node clusters faking a chart |
| `viz-stray-ticks` | visual | FIX | decorative radiating ticks on a gauge/arc |
| `glyph-on-metric` | visual | FIX | an emoji/icon stacked on a numeric value |
| `stat-label-icon` | visual | FIX | a redundant leading icon on a stat's category label |
| `edge-stripe` | visual | FIX | thick colored border-left/right rails on cards and rows |
| `redundant-border` | visual | FIX | opaque borders boxing already-filled elements |
| `dark-glow` | visual | FIX | saturated wide-blur glow shadows (the neon dark-SaaS look) |
| `over-rounded-card` | visual | FIX | 40px+ radii turning filled cards into blobs |
| `ghost-card` | visual | FIX | hairline border + wide soft halo on one surface |
| `floating-hero-card` | layout | FIX | decorative badge cards floated over the hero |
| `grid-spacer-void` | layout | FIX | hairline dividers stranded in tall fixed grid rows |
| `wrap-padding-collision` | layout | FIX | `padding: V 0` clobbering the container's inset |
| `body-display-contents` | layout | FIX | `display:contents` on `<body>` collapsing the page |
| `hscroll-snap-gutter` | layout | BASE | snap carousels missing scroll-padding for their gutter |
| `hero-kicker-eyebrow` | layout | FIX | the uppercase kicker badge above the H1 |
| `reveal-specificity-trap` | layout | FIX | scroll-reveal CSS whose hidden state wins forever |
| `row-kicker-eyebrow` | layout | FLAG | ALL-CAPS kickers stacked above every list row's title |
| `multiline-row-meta` | layout | FLAG | quotes/descriptions wrapping to 2+ lines inside list rows |
| `overstuffed-row` | layout | FLAG | repeated rows carrying more than 3 info slots |
| `row-as-card` | layout | FLAG | uniform text rows each boxed as its own elevated card |
| `nested-cards` | layout | GATE | surfaced card containers nested inside cards |
| `numbered-section-markers` | layout | FLAG | decorative 01 / 02 / 03 section scaffolding |
| `icon-topped-feature-card` | layout | FLAG | the icon-heading-blurb card template, x3 |
| `transition-all` | motion | GATE | `transition: all` instead of named properties |
| `will-change-misuse` | motion | FIX | will-change on layout/paint props or `all` |
| `bounce-easing` | motion | FIX | overshoot cubic-bezier springs on UI motion |
| `layout-prop-animation` | motion | GATE | transitions on width/height/top/left/margin/padding |
| `hover-scale-image` | motion | FLAG | the reflex scale() zoom on image hover |
| `cents-suffix` | copy | FIX | fake `.20` price-decimal suffix spans |
| `oversized-number` | copy | FIX | un-abbreviated figures of 10,000+ |
| `em-dash-copy` | copy | FIX | em dashes (U+2014) in interface copy |
| `lorem-ipsum` | copy | GATE | lorem-ipsum filler in a finished screen |
| `viz-redundant-scale` | copy | FIX | 0/N gauge endpoint labels restating a 7/10 value |
| `live-clock-eyebrow` | copy | FIX | "LIVE 09:41" dot badges and wall-clock eyebrows |
| `publication-masthead-block` | copy | FIX | invented VOLUME/CATALOGUE/serial metadata clusters |
| `masthead-eyebrow` | copy | FIX | lone VOL./ISSUE/№ magazine eyebrows |
| `benefit-speak` | copy | GATE | Elevate / Supercharge / Seamlessly marketing filler |
| `not-x-but-y-cadence` | copy | FLAG | the "it's not just X, it's Y" rebuttal rhythm |
| `fabricated-precision` | copy | FLAG | 99.9% / 10x / #1 / "trusted by thousands" filler stats |
| `apologetic-error-copy` | copy | GATE | "Oops! Something went wrong" error copy |
| `broken-image` | imagery | FIX | empty, missing, or template-placeholder `src` |
| `missing-alt` | imagery | FIX | `<img>` without an alt attribute |
| `placeholder-image` | imagery | GATE | placeholder-service URLs (pravatar, picsum...) |
| `image-outline` | imagery | BASE | content images with no inset edge hairline |
| `justified-text` | quality | FIX | rivers-of-white justified copy |
| `missing-lang` | quality | FIX | `<html>` without a `lang` attribute |

### Opting out intentionally

A deliberately "slop-shaped" element opts out per rule, visibly in the
markup, so the decision is reviewable:

- element rules: `data-slop-allow="rule-id"` attribute (list or `"all"`),
- CSS rules: a `--slop-allow: rule-id` custom property in the same
  declaration block.

## Library

```ts
import {
  runSlopGuard,
  applySlopFixes,
  buildSlopConstraintsBlock,
  FLAGSHIP_RULES,
} from "@gessobuild/anti-slop"

const check = runSlopGuard(html, {}, FLAGSHIP_RULES)
// { pass, issues, severity, counts }

const fixed = applySlopFixes(html, {}, FLAGSHIP_RULES)
// { html, fixes, total } -- idempotent

const promptBlock = buildSlopConstraintsBlock(undefined, FLAGSHIP_RULES)
// negative constraints to paste into your generation system prompt
```

Each rule is one source of truth for three artifacts: a **prevention**
constraint you inject into a generation prompt, a **detect** pass over the
HTML string, and (for FIX-tier rules) a deterministic **fix**. The engine is
generic over the rule context: register your own rules with richer
style/token types alongside (or instead of) the flagship registry. Every
detect/fix call is wrapped in try/catch, so a buggy rule degrades to "no
hit / no fix" and never breaks a pipeline. Faithful-replication workflows
can pass `{ replicate: true }` to sanction expressive treatments (gradient
headlines) the reference legitimately uses.

## Security

The detector parses markup as text. It never executes, renders, or
fetches anything: no network access, no child processes, no install
hooks, and a single runtime dependency (`node-html-parser`). Evidence
excerpts quoted into a report are length-bounded, and the skill treats
them strictly as data to report, never as instructions to follow. As
with any tool that quotes untrusted file content to an agent, a bounded
injection surface is inherent to the category; the automated audit
results on the [skills.sh
listing](https://skills.sh/gesso-build/skills/anti-slop) carry the
detail.

## Made by Gesso

This package is maintained by [Gesso](https://gesso.build), the AI
creative team for builders: explore the sea of creative ideas and build
with Gesso. Designs created at [app.gesso.build](https://app.gesso.build)
arrive with this check already applied; run it on everything else you
ship.

## License

MIT
