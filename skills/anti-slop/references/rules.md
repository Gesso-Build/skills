# The guard catalog

Every rule the detector actually runs, with its exact detection condition,
why the pattern reads as generated-UI slop, a before/after pair, and what
the auto-fix rewrites. Severity is per hit; a rule's total contribution to a
file's score is capped at 4 so one runaway pattern cannot drown the rest.

Tiers: **FIX** rules are auto-fixed by `npx -y @gessobuild/anti-slop fix <file>
--write`, deterministically and idempotently. **GATE** rules are
detect-only: the right fix needs a decision the tool refuses to fake, so
they are reported for you to resolve. **BASE** rules are additive polish:
their absence is not a defect (they never count toward pass/severity), but
`fix` injects the default once, idempotently, into full documents.

Opt-outs (for deliberate design decisions, never for making the check
pass): element rules honor a `data-slop-allow="rule-id"` attribute on the
element; CSS rules honor a `--slop-allow: rule-id` custom property inside
the same declaration block. Both accept a space/comma list of ids or
`"all"`.

---

## Color

### gradient-text (severity 1, FIX)

**Detects:** a CSS declaration group (a `<style>` rule body or an inline
`style=""`) that clips a background into the letterforms: `background-clip:
text` (with or without the `-webkit-` prefix) together with a transparent
fill (`color`, `-webkit-text-fill-color`, or `fill` set to `transparent`).

**Why it reads as slop:** a gradient poured into a headline or metric is
decoration carrying no meaning, and it is the single most recognizable
generated-heading treatment of the current era. Strong type earns emphasis
from size, weight, and color, not from a rainbow fill.

```html
<!-- bad -->
<h1 style="background: linear-gradient(90deg, #ff00cc, #3333ff);
           -webkit-background-clip: text; background-clip: text;
           color: transparent">Grow faster</h1>
<!-- good -->
<h1 style="color: #16181d">Grow faster</h1>
```

**Auto-fix:** removes the clip and gradient declarations and sets the fill
to the gradient's first color stop (or `currentColor` when no stop is
parseable), so the headline keeps a related solid color.

**Sanctioned when:** replication mode (`{ replicate: true }` in the library
API), for faithfully reproducing a reference whose hero legitimately uses a
gradient headline. CSS opt-out: `--slop-allow: gradient-text`.

### indigo-accent (severity 1, FIX)

**Detects:** any of the ten Tailwind indigo/violet accent hexes (`#6366f1`,
`#818cf8`, `#4f46e5`, `#4338ca`, `#3730a3`, `#8b5cf6`, `#7c3aed`,
`#6d28d9`, `#a78bfa`, `#5b21b6`) used in a declaration VALUE. Custom
property definitions (`--accent: #6366f1`), `content` literals, and
`url(...)` values (SVG fragment ids) are skipped.

**Why it reads as slop:** indigo-500 is what a model reaches for when
nobody chose a brand color. It is the fingerprint hue of generated UI; a
real product has an accent someone picked on purpose.

```html
<!-- bad -->
<button style="background: #6366f1; color: #fff">Upgrade</button>
<!-- good -->
<button style="background: var(--accent, currentColor); color: #fff">Upgrade</button>
```

**Auto-fix:** replaces each indigo hex with `var(--accent, currentColor)`,
deferring to the host page's accent token. If your design system genuinely
uses indigo, define it as your `--accent` (or opt out with `--slop-allow:
indigo-accent` in that block) so the choice is explicit.

### gradient-fill (severity 1, FIX)

**Detects:** a declaration group that is a rounded ENTITY (it declares a
`border-radius`) whose `background` / `background-image` /
`background-color` carries a `linear-`, `radial-`, or `conic-gradient()`
whose readable, saturated color stops all belong to ONE hue family (stops
within 28 degrees of hue, saturation at least 0.15). Blocks with any
`url()` in a background declaration are skipped (that is a photo plus a
scrim, not a tile fill), as are `background-clip: text` groups
(gradient-text owns those) and gradients with no saturated stop (pure
black/white scrims and tints are not a color tell).

**Why it reads as slop:** the gradient-filled icon tile and button is a
top generated-UI fingerprint. A designer fills a tile with one confident
color; the gradient version is what a model produces when it wants a
surface to feel "designed" without making a choice.

```html
<!-- bad -->
<div style="border-radius: 12px;
            background: linear-gradient(135deg, #22c55e, #16a34a)">...</div>
<!-- good -->
<div style="border-radius: 12px; background: #22c55e">...</div>
```

**Auto-fix:** collapses every background declaration in the block to one
solid `background: <color>`, keeping the gradient's first saturated stop
so the tile stays in its own hue. CSS opt-out: `--slop-allow:
gradient-fill` in the same block.

### multicolor-fill (severity 1, FIX)

**Detects:** the same rounded-entity gradient shape as gradient-fill, but
with TWO OR MORE divergent saturated hues among the stops (any pair more
than 28 degrees apart): the pink-to-purple or orange-to-pink tile. The
same carve-outs apply (no radius, `url()` backgrounds, clip-to-text, no
saturated stop).

**Why it reads as slop:** two competing hues blended across one small
surface is chromatic noise with no meaning, and it is the LOUD version of
the gradient-tile tell. No hue can fairly be kept, so the fix mutes
rather than picks a winner.

```html
<!-- bad -->
<div style="border-radius: 12px;
            background: linear-gradient(135deg, #f97316, #ec4899)">...</div>
<!-- good -->
<div style="border-radius: 12px;
            background: var(--surface, rgba(128,128,128,0.12))">...</div>
```

**Auto-fix:** collapses the background declarations to one muted neutral
surface tone (`var(--surface, rgba(128,128,128,0.12))`), deferring to the
host page's surface token when defined. CSS opt-out: `--slop-allow:
multicolor-fill`.

---

### multicolor-heading (severity 1, FIX)

**Detects:** an `h1`/`h2`/`h3` that is a prose headline (three or more
words, lowercase letters present) containing at least one inline
descendant (`span`, `em`, `strong`, `b`, `i`, `mark`, `small`, `u`, or an
`<a>` with no href) whose resolved `color` (class rules + inline style,
inline winning) is set and not `inherit`/`currentColor`, while base text
outside those spans remains. The prose gate spares app patterns that
borrow a heading tag: a stat value with a colored unit, an all-caps brand
statement, a two-word screen label. Wholly recolored headlines never fire;
the rule needs a MIX of inks.

**Why it reads as slop:** dipping half the sentence in the accent is the
default emphasis move of generated landings. It splits one thought into
two visual voices and spends the accent color on decoration instead of
action.

```html
<!-- bad -->
<h1>Composed <span style="color:#e2725b">in sequence.</span></h1>
<!-- good -->
<h1>Composed in sequence.</h1>
```

**Auto-fix:** forces each colored fragment to `color:inherit` (its other
styling survives), so the headline reads as one ink. Element opt-out:
`data-slop-allow="multicolor-heading"` on the heading. Sanctioned in
replication mode (`{ replicate: true }`), where the reference's exact
treatment is the contract.

---

### purple-violet-wash (severity 1, FIX)

**Detects:** any literal color (hex / rgb() / hsl()) in a declaration value
whose hue lands in 252-296 degrees at saturation >= 0.30 and lightness
0.25-0.88: the saturated violet band. The ten exact indigo hexes are
excluded (indigo-accent owns them, so nothing double-counts), as are
custom-property definitions, `content:` literals, `url(...)` values, and
all shadow/filter colors (a violet glow belongs to dark-glow, which drops
the layer instead of recoloring it).

**Why it reads as slop:** indigo has a hex list; purple has a whole band.
Models that dodge the exact fingerprint hexes still land in saturated
violet, the most recognized "nobody chose this" color story in generated
UI.

**Auto-fix:** swaps each violet token for `var(--accent, currentColor)`,
deferring to the page's real accent. A genuinely purple brand defines
`--accent` (or opts out per block with `--slop-allow: purple-violet-wash`)
so the choice is explicit. Sanctioned in replication mode.

---

### safe-green-default (severity 1, FLAG)

**Detects:** Tailwind's emerald/green accent hexes (`#10b981`, `#34d399`,
`#059669`, `#047857`, `#065f46`, `#22c55e`, `#16a34a`, `#4ade80`,
`#15803d`) in declaration values, with the same custom-property /
`content` / `url()` exclusions as the violet rule.

**Why it reads as slop:** it is the second-order tell: deny a model
purple and it retreats to emerald, the next "distinctive" non-choice.
Green is a fine accent when the brand owns it, which is why this is
advisory.

**Advisory (FLAG):** reported, never counted; green fintech and
sustainability brands are real. Opt out per block with
`--slop-allow: safe-green-default`.

---

### cream-default-wash (severity 1, FLAG)

**Detects:** the page ground (a `body`/`html` background hex) sitting in
the warm cream band (hue 25-60, saturation 0.10-0.50, lightness >= 0.82)
COMBINED with a serif display voice (a `font-family` whose leading family
is serif, not a sans stack's trailing generic). One hit per page.

**Why it reads as slop:** cream + serif is the "tasteful startup"
costume: an editorial voice applied by default to products that are not
editorial, cited across every 2026 tell list as the polite twin of the
purple gradient.

**Advisory (FLAG):** genuinely editorial briefs earn this pairing, so it
reports without gating. Opt out with `data-slop-allow` on the body or
`--slop-allow: cream-default-wash` in the body rule.

---

## Type

### hollow-text (severity 2, FIX)

**Detects:** a declaration group carrying a glyph only by its outline:
any `-webkit-text-stroke` (or `text-stroke`) declaration combined with a
transparent fill, in the same rule body or inline style. Groups already
flagged as gradient-text are excluded.

**Why it reads as slop:** outlined "hollow" display type is a poster
gimmick that generated UI overuses, and it is a rendering hazard:
`-webkit-text-stroke` is non-standard, and wherever the stroke is not
painted the text is literally invisible. Severity 2 because it can fail
WCAG outright.

```html
<!-- bad -->
<h2 style="color: transparent; -webkit-text-stroke: 1.5px #16181d">SS26</h2>
<!-- good -->
<h2 style="color: #16181d; opacity: 0.85">SS26</h2>
```

**Auto-fix:** strips the stroke declarations and restores a solid
`currentColor` fill. For a deliberately quiet read, reduce opacity instead
of hollowing the glyph.

### underlined-text (severity 1, FIX)

**Detects:** `text-decoration: underline` (including `text-decoration-line`
and multi-value forms) anywhere in markup or styles, and any `<u>` tag.

**Why it reads as slop:** underlines in product UI read as either a raw
hyperlink default nobody styled or a typewriter document. Polished
interfaces set links apart with weight or color and reserve decoration for
prose contexts.

```html
<!-- bad -->
<a style="text-decoration: underline">View report</a>
<!-- good -->
<a style="text-decoration: none; color: var(--accent, currentColor); font-weight: 600">View report</a>
```

**Auto-fix:** rewrites the declaration to `text-decoration:none` and strips
`<u>` tags (keeping their content).

### all-caps-body (severity 1, FIX)

**Detects:** a `<p>` element with `text-transform: uppercase` in its inline
style whose visible text is longer than 60 characters.

**Why it reads as slop:** we recognize words by their ascender/descender
silhouette; long uppercase passages flatten that shape and force
letter-by-letter reading. All-caps is a label treatment (a few words with
letterspacing), never a paragraph treatment.

```html
<!-- bad -->
<p style="text-transform: uppercase">Our platform helps teams move faster by
automating the busywork that slows every launch down.</p>
<!-- good -->
<p>Our platform helps teams move faster by automating the busywork that
slows every launch down.</p>
```

**Auto-fix:** removes the `text-transform: uppercase` declaration from the
long paragraph; short labels are untouched. Element opt-out:
`data-slop-allow="all-caps-body"`.

### emoji-icon (severity 1, FIX)

**Detects:** an emoji (with optional variation selectors / ZWJ sequences)
sitting at the very start of an `<a>`, `<button>`, heading, `<span>`,
`<li>`, `<dt>`, `<dd>`, `<figcaption>`, `<label>`, `<strong>`, `<b>`, or
`<small>`, immediately followed by text.

**Why it reads as slop:** an emoji standing in for an icon is the tell that
no icon system exists. Emoji render differently on every platform, ignore
your palette, and read as chat, not chrome.

```html
<!-- bad -->
<li>🚀 Instant deploys</li>
<!-- good -->
<li><svg class="icon" aria-hidden="true">...</svg> Instant deploys</li>
<!-- also good -->
<li>Instant deploys</li>
```

**Auto-fix:** strips the leading emoji and keeps the label. Emoji inside
running prose are left alone; only the icon position (leading a label) is
flagged. Element opt-out: `data-slop-allow="emoji-icon"`.

### text-wrap-orphans (severity 1, BASE)

**Detects:** a full document (it has `<html>`, `<body>`, or `</head>`)
that contains headings or body-copy elements (`h1`-`h3`, `p`, `li`,
`figcaption`, `blockquote`) but no `<style id="gesso-text-wrap">` polish
block yet. Bare fragments are never touched.

**Why it matters:** headings that rag unevenly and paragraphs that strand
a single word on the last line read as unpolished, and the platform fixes
both for free: `text-wrap: balance` evens heading lines, `text-wrap:
pretty` prevents orphans in copy. Absence is not a defect (BASE tier), so
this never affects the verdict; it is a default worth having.

```html
<!-- injected once, idempotent on the id -->
<style id="gesso-text-wrap">h1,h2,h3{text-wrap:balance}p,li,figcaption,blockquote{text-wrap:pretty}</style>
```

**Auto-fix:** injects that one marked block before `</head>` (falling
back to just after `<body>`). Opt out by shipping your own (even empty)
`<style id="gesso-text-wrap">` block.

### font-smoothing (severity 1, BASE)

**Detects:** a full document with no `<style id="gesso-font-smoothing">`
polish block.

**Why it matters:** default macOS text rendering is heavier than most
type was designed for; `-webkit-font-smoothing: antialiased` plus
`-moz-osx-font-smoothing: grayscale`, set ONCE at the root, lightens it
to the intended weight. Non-macOS platforms ignore both, so the
declaration is safe everywhere. BASE tier: never affects the verdict.

```html
<!-- injected once, idempotent on the id -->
<style id="gesso-font-smoothing">html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}</style>
```

**Auto-fix:** injects that one marked block. Opt out by shipping your own
`<style id="gesso-font-smoothing">` block.

---

### mixed-style-headline (severity 1, FIX)

**Detects:** a prose `h1`/`h2`/`h3` whose own resolved `font-style` is
upright but which contains a descendant resolving to italic or oblique,
via an `em`/`i`/`cite`/`var`/`dfn` tag default or a
`font-style: italic` from class or inline styles, while upright base text
remains. A wholly italic headline is one consistent voice and never
fires; the rule requires the mid-sentence switch.

**Why it reads as slop:** the upright-then-italic swerve is manufactured
sophistication, italicizing a phrase to fake an editorial cadence the
copy does not have. One headline, one style.

```html
<!-- bad -->
<h1>Thrown on a kick wheel. <em>Fired three times.</em></h1>
<!-- good -->
<h1>Thrown on a kick wheel. Fired three times.</h1>
```

**Auto-fix:** pins each italic fragment to `font-style:normal`, keeping
the words and any other styling. Element opt-out:
`data-slop-allow="mixed-style-headline"` on the heading. Sanctioned in
replication mode.

---

### overused-font-stack (severity 1, FLAG)

**Detects:** Inter, Space Grotesk, Geist, or Instrument Serif named in
any `font-family` declaration or Google Fonts stylesheet URL. One hit per
distinct family found.

**Why it reads as slop:** these four faces headline every list of AI
design tells; they are good typefaces exhausted by being the default
reach. A face that argues for the subject is the difference between a
designed page and a generated one.

**Advisory (FLAG):** a deliberate Inter body under a distinctive display
face is defensible, so this reports without gating.

---

### single-font-page (severity 1, FLAG)

**Detects:** a full document with two or more `font-family` declarations
whose leading (non-generic) family names all resolve to ONE family.
Generic keywords (serif, sans-serif, monospace, system-ui, ui-*) are
ignored; pages with fewer than two declarations stay quiet.

**Why it reads as slop:** one family at one register carrying display,
body, and UI reads as unstyled output, not typographic restraint. Real
single-family systems vary optical size, width, or weight with intent.

**Advisory (FLAG):** deliberate one-face systems exist; treat the hit as
a prompt to check whether the page has a display voice at all.

---

### crushed-tracking (severity 1, FIX)

**Detects:** `letter-spacing` at -0.05em or tighter (px normalized at
16px/em) in any declaration group.

**Why it reads as slop:** negative tracking is the one knob generated CSS
turns to make display type look "designed", and past about -0.04em the
glyphs weld together. Compression is not sophistication.

**Auto-fix:** clamps the declaration to -0.02em, the safe end of tight
display tracking. Opt out per block with `--slop-allow: crushed-tracking`.

---

### wide-body-tracking (severity 1, FIX)

**Detects:** `letter-spacing` at 0.08em or wider in a group that does NOT
also set `text-transform: uppercase` (tracked caps are a real pattern)
and is not a micro-label (font-size <= 13px in the same group is spared).

**Why it reads as slop:** wide tracking on mixed-case text destroys the
word shapes readers scan by; it looks airy in a screenshot and reads like
wading. The legitimate home of wide tracking is the short uppercase
label.

**Auto-fix:** clamps the declaration to 0.01em. Opt out per block with
`--slop-allow: wide-body-tracking`.

---

### tight-line-height (severity 1, FIX)

**Detects:** a declaration group that sets BOTH a body-range font-size
(13-20px) and a line-height under 1.25 (unitless, or px against that
size). Groups without their own font-size stay quiet (inheritance is
unknowable statically), and display/micro sizes set their own rules.

**Why it reads as slop:** shingled body lines are the density cosplay of
generated dashboards: 15px text at 1.1 leading photographs as "compact"
and reads as a wall.

**Auto-fix:** raises the group's line-height to 1.4. Opt out per block
with `--slop-allow: tight-line-height`.

---

### tiny-body-text (severity 1, FIX)

**Detects:** `font-size` under 11px (px, or rem/em normalized at 16px) in
a group without `text-transform: uppercase` (tracked uppercase
micro-labels at 10px are a deliberate pattern and are spared).

**Why it reads as slop:** sub-11px mixed-case text is below the
legibility floor on high-DPI screens; it exists to make a mock look
information-dense, not to be read.

**Auto-fix:** raises the declaration to 12px. Opt out per block with
`--slop-allow: tiny-body-text`.

---

### monospace-body (severity 1, FLAG)

**Detects:** a style rule whose selector targets `body` or `p` (bare
element selectors, not `.body-x` classes) with a `font-family` naming a
monospace face (the `monospace` generic, Mono-family names, Courier,
Consolas, Menlo).

**Why it reads as slop:** prose in a code font is terminal cosplay: a
whole page pretending to be a CLI because the product is technical. Code
belongs in `<code>`; paragraphs belong in a text face.

**Advisory (FLAG):** developer-tool landings do this deliberately often
enough that it reports without gating.

---

## Visual

### heavy-box-shadow (severity 2, FIX)

**Detects:** a `box-shadow` value that is any of: three or more blurred
non-inset layers; two or more blurred non-inset layers where any layer's
alpha exceeds 0.12; or a single blurred non-inset layer with alpha above
0.30. Inset layers, hard-edged offsets (blur 0), and values already using a
shadow token (`var(--*shadow*)`) never count.

**Why it reads as slop:** the stacked ambient-glow shadow under a routine
card is the "puffy floating card" signature of generated UI. Real elevation
systems use one subtle layer, or skip shadows entirely and separate
surfaces by tone.

```html
<!-- bad -->
<div style="box-shadow: 0 4px 6px rgba(0,0,0,0.1), 0 10px 25px rgba(0,0,0,0.15),
            0 20px 48px rgba(0,0,0,0.18)">...</div>
<!-- good -->
<div style="box-shadow: 0 1px 2px rgba(0,0,0,0.06)">...</div>
```

**Auto-fix:** flattens the offending value to the single subtle layer
`0 1px 2px rgba(0,0,0,0.06)`. CSS opt-out: `--slop-allow:
heavy-box-shadow` in the same block.

### gradient-border (severity 1, FIX)

**Detects:** `border-image` or `border-image-source` whose value contains a
`linear-`, `radial-`, or `conic-gradient`.

**Why it reads as slop:** the multi-stop gradient ring around an avatar,
thumbnail, or card is decorative chrome borrowed from story UIs; on
anything else it is loud, dated, and screams template.

```html
<!-- bad -->
<img class="avatar" style="border-image: linear-gradient(45deg, #f0f, #0ff) 1"
     src="team/ana.jpg" alt="Ana">
<!-- good -->
<img class="avatar" style="border: 1px solid rgba(0,0,0,0.08)"
     src="team/ana.jpg" alt="Ana">
```

**Auto-fix:** strips the gradient border-image declarations; the element's
own rounded corners are the finish.

### bare-hr (severity 1, FIX)

**Detects:** an `<hr>` with no border styling in its attributes.

**Why it reads as slop:** the user-agent default `<hr>` renders as a
full-opacity inset 3D groove, a 1996 artifact. Sections separate with
space, typography, or at most a hairline.

```html
<!-- bad -->
<hr>
<!-- good -->
<hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);">
```

**Auto-fix:** rewrites the bare `<hr>` to that hairline (alpha 0.08).
Element opt-out: `data-slop-allow="bare-hr"`.

### decorative-divider (severity 1, FIX)

**Detects:** runs of two or more box-drawing characters (U+2500 to U+2570,
U+2574 to U+257F), or runs of two or more em/en dashes, used in visible
text.

**Why it reads as slop:** terminal-art rules between labels are chrome that
conveys nothing and break the first time the font or width changes. They
are how a language model draws a line when it cannot draw a line.

```html
<!-- bad -->
<div class="label">OVERVIEW ───────────── Q3</div>
<!-- good -->
<div class="label" style="display:flex; align-items:center; gap:12px">
  OVERVIEW <span style="flex:1; border-top:1px solid rgba(0,0,0,0.08)"></span> Q3
</div>
```

**Auto-fix:** removes the character runs. If you want a visual rule, draw a
real hairline as above.

### repeating-gradient-stripe (severity 1, FIX)

**Detects:** any `repeating-linear-gradient()`, `repeating-radial-gradient()`,
or `repeating-conic-gradient()` in markup or styles.

**Why it reads as slop:** repeating-gradient stripes are texture without
intent, the CSS equivalent of construction tape. When generated UI wants a
surface to feel less empty it reaches for stripes; a designed surface uses
a flat tone or a pattern that means something.

```html
<!-- bad -->
<div style="background: repeating-linear-gradient(45deg, #111 0 2px, transparent 2px 6px)"></div>
<!-- good -->
<div style="background: #111"></div>
```

**Auto-fix:** replaces the whole repeating-gradient function (balanced
parens, so nested `var()`/`rgba()` stops are handled) with its first color
stop, falling back to `transparent`.

### fake-dot-viz (severity 2, FIX)

**Detects:** a `<span>`/`<div>` wrapper whose class marks it as a
mini-chart (`pulse`, `momentum`, `sparkdots`, `trend-dots`, `dot-row`,
`dot-grid`, `dot-cluster`, `node-row`, `nodes`) and whose ENTIRE content
is three or more empty child elements classed `dot`/`node`/`spark`. The
wrapper-class anchor keeps carousel/pagination indicators and avatar
stacks safe.

**Why it reads as slop:** a row of identical dots pretending to be a
"momentum" or "pulse" chart encodes zero data. It exists to make a list
row look quantitative, and it collides with the real value column. Data
visualization that shows nothing is the purest form of slop, hence
severity 2.

```html
<!-- bad -->
<span class="dot-row"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
<!-- good: a real sparkline, or just the number -->
<span class="delta">+4.2%</span>
```

**Auto-fix:** removes the whole cluster. Replace it with a real sparkline
or a plain number + delta.

### viz-stray-ticks (severity 2, FIX)

**Detects:** inside an arc/gauge `<svg>` (one whose `<path d>` uses an
elliptic-arc `A`/`a` command with `fill="none"`; filled arcs like pie
slices and logos never qualify), THREE or more short `<line>`s (length at
most 16 viewBox units) or thin tick-sized `<rect>`s that do not live under
a labelled tick group (an ancestor classed `tick`/`axis`/`grid`/`scale`/
`marks`/`ruler`).

**Why it reads as slop:** unlabeled ticks radiating around a gauge rim are
the strongest generated-gauge tell. A real scale has labels; seven
anonymous 8px dashes are chrome pretending to be measurement.

```html
<!-- bad: three anonymous ticks sprayed on the rim -->
<svg viewBox="0 0 100 60"><path d="M10 50 A40 40 0 0 1 90 50" fill="none"/>
  <line x1="10" y1="10" x2="16" y2="12"/> ...
</svg>
<!-- good: the arc, the value, nothing else -->
<svg viewBox="0 0 100 60"><path d="M10 50 A40 40 0 0 1 90 50" fill="none"/></svg>
```

**Auto-fix:** removes the stray ticks (and any wrapper `<g>` left truly
empty). The arc, values, and labelled tick groups survive. Element
opt-out: `data-slop-allow="viz-stray-ticks"` on the `<svg>`.

### glyph-on-metric (severity 2, FIX)

**Detects:** two branches, one removal pass. (A) DATAVIS: a decorative
emoji-only element or catalog icon (`svg`/`[data-icon]`/`.ic`) inside a
viz container (an ancestor carrying `data-viz`, holding a real arc/gauge
svg, or ring/gauge-classed) that ALSO shows a numeric value in a different
branch of the same container; a catalog icon must additionally be floated
(aria-hidden or absolutely positioned) and not the intentional
centered-in-ring glyph (`translate(-50%,-50%)` is spared). (B)
PERCENTAGE: every catalog icon and emoji/symbol glyph inside the bounded
stat unit (at most 64 visible characters, one value) around an `NN%`
value. Page chrome (nav, status/tab bars) is never entered, and `<img>`
is never treated as an icon (a flag beside a stat can be the data).

**Why it reads as slop:** the number IS the visual. An emoji centered
behind a progress ring's "74%" collides with the digits; an arrow or icon
chip beside a stat pollutes the figure it decorates. Removal widens to
the smallest wholly-decorative wrapper (aria-hidden or
decoration-classed, holding no data) so orbiting blobs leave with the
glyph.

```html
<!-- bad -->
<div class="progress-ring"><div class="figure">🏋️</div><span>74%</span></div>
<!-- good -->
<div class="progress-ring"><span>74%</span></div>
```

**Auto-fix:** removes the glyph (or its wholly-decorative wrapper); the
value and the arc always survive. Element opt-out:
`data-slop-allow="glyph-on-metric"` on the glyph or any ancestor inside
the stat.

### stat-label-icon (severity 1, FIX)

**Detects:** in a small stat tile (at most 24 visible characters within
three ancestor hops), a category label (pure word text of 2 to 20
letters, no digits or `%`) whose FIRST element child is an icon
(`svg`/`img`/`[data-icon]`/`.ic`), where a numeric value leaf (`42`,
`1.2k`, `98%`) sits in the same tile BEFORE the label in document order.
The number-before-label guard means a nav row with a leading icon and a
trailing count badge ("Settings ... 3") never matches: there the icon is
the affordance.

**Why it reads as slop:** the label word already names the category, so a
leading icon is duplicate information, the icon-plus-its-own-caption
double signal. In a stat tile the number is the primary read; everything
else should get out of its way.

```html
<!-- bad -->
<div class="tile"><div class="num">42</div><div class="cat"><svg class="ic">...</svg> ALL</div></div>
<!-- good -->
<div class="tile"><div class="num">42</div><div class="cat">ALL</div></div>
```

**Auto-fix:** removes the leading icon, keeping the number and the word.
Element opt-out: `data-slop-allow="stat-label-icon"` on the label
element.

---

### edge-stripe (severity 1, FIX)

**Detects:** any style-rule body or inline style declaring
`border-left` or `border-right` (or their `-width` longhands) at 3px or
wider in a visible color. Selector-aware: rules scoped to a selection
state (`[aria-selected]`, `[aria-current]`, `:checked`,
`.active`/`.selected`/`.current`/`.is-*`) are skipped, as are inline
styles on elements carrying those state markers, so a single selected
row keeping its accent edge is legal.

**Why it reads as slop:** the colored rail is how generated UI fakes a
category system: every row gets a 4px accent edge and the list looks
"designed" without any real encoding. Hairlines stay under the 3px
threshold; only the decorative rail is stripped.

```html
<!-- bad -->
<div class="card" style="border-left:4px solid #e2725b">Standups</div>
<!-- good -->
<div class="card">Standups <span class="chip">Ritual</span></div>
```

**Auto-fix:** removes the `border-left`/`border-right` declarations from
each offending group; every other declaration survives. Opt out per
group with `--slop-allow: edge-stripe` or per element with
`data-slop-allow="edge-stripe"`.

---

### redundant-border (severity 1, FIX)

**Detects:** a declaration group carrying BOTH a real background fill
(not `none`/`transparent`/`inherit`) AND a visible box border: 1px+ in a
color that is not transparent, under 10% alpha, or a
divider/hairline/stroke token. Skipped wholesale on interactive and
structural surfaces where a border is the affordance: buttons, inputs,
selects, table cells, `pre`/`code`/`kbd`, alert/callout/chip/tab/field
classes, `[type=]`/`[role=]` attributes, and any `:hover`/`:focus`/state
selector.

**Why it reads as slop:** boxing an already-filled card is double
separation, the visual equivalent of saying it twice. Real systems pick
one edge strategy per surface; generated output stacks both by default.

```html
<!-- bad -->
<div style="background:#f6f1ea;border:1px solid #d8cfc2;border-radius:12px">...</div>
<!-- good -->
<div style="background:#f6f1ea;border-radius:12px">...</div>
```

**Auto-fix:** strips the border declarations (radius stays, fill stays).
Low-alpha hairlines are never touched, so a deliberate 5% outline
survives. Opt out with `--slop-allow: redundant-border` in the block or
`data-slop-allow` on the element.

---

### dark-glow (severity 2, FIX)

**Detects:** a non-inset `box-shadow`/`text-shadow` layer, or a
`drop-shadow()` filter, whose color is saturated (S >= 0.4) with blur >=
12px and alpha >= 0.15: the neon halo. Neutral elevation shadows have no
chroma and never match; heavy-box-shadow separately owns over-heavy
NEUTRAL stacks.

**Why it reads as slop:** light does not leak out from under cards. The
saturated glow behind buttons and bento tiles is the signature move of
the generated "premium dark SaaS" look, decoration posing as depth.

```css
/* bad */  .cta { box-shadow: 0 0 40px rgba(6,182,212,0.4) }
/* good */ .cta { box-shadow: 0 1px 2px rgba(0,0,0,0.24) }
```

**Auto-fix:** removes the chromatic glow layers, keeping any neutral
layers in the same declaration (an empty declaration is dropped whole).
Runs before purple-violet-wash so a violet glow dies as a glow. Opt out
per block with `--slop-allow: dark-glow`.

---

### over-rounded-card (severity 1, FIX)

**Detects:** a filled surface (real background) whose `border-radius` is
a single pixel value from 40 to 120. Pills and full circles pass (their
9999px / 50% conventions fall outside the band), as do unfilled wrappers.

**Why it reads as slop:** 40px+ corners turn content cards into blobs:
the "friendly" dial turned past its stop, with text left floating in
amorphous shapes. Confident systems hold 8-24px.

**Auto-fix:** clamps the radius to 24px, keeping fill and everything
else. Opt out per block with `--slop-allow: over-rounded-card`.

---

### ghost-card (severity 1, FIX)

**Detects:** a declaration group carrying BOTH a hairline border (0.5px
or 1px) AND a wide soft shadow (blur >= 24px at alpha <= 0.18): two
separation strategies hedged onto one surface.

**Why it reads as slop:** the border says "I sit in the plane", the halo
says "I float above it". Together they read as a template that could not
decide, the ghost hovering under every generated pricing card.

**Auto-fix:** keeps the hairline (the more structural of the two) and
removes the box-shadow declaration. Opt out per block with
`--slop-allow: ghost-card`.

---

## Layout

### floating-hero-card (severity 1, FIX)

**Detects:** a small card floated over a hero: an element that is (a)
`position: absolute` or `fixed`, (b) a card surface (`border-radius` plus
a background fill, backdrop blur, or shadow), (c) corner-pinned (a
vertical AND a horizontal offset, or a non-zero `inset`), (d) short
decorative content (at most 90 characters, and NO heading, link, button,
form control, nav, list, or image), and (e) overlaying a `section`/
`header`/hero-classed ancestor that also holds a real `h1`/`h2` outside
the card. Outermost matches only.

**Why it reads as slop:** the corner-pinned, backdrop-blurred spec chip
("Atelier Lab / Edition No 08") is a generated-landing signature. It
overlaps the artwork, restates nothing a reader needs, and exists to make
a hero look "layered". Condition (e) is what makes the removal safe: the
hero's own content column can never match.

```html
<!-- bad -->
<section class="hero"><h1>Skin is a living archive</h1>
  <div style="position:absolute; top:16px; right:16px; border-radius:12px;
              background:rgba(255,255,255,0.2)">Atelier Lab · No 08</div>
</section>
<!-- good: the detail moves inline, or disappears -->
<section class="hero"><h1>Skin is a living archive</h1></section>
```

**Auto-fix:** removes the floating card(s). If the detail matters, place
it inline in the hero's content column. Element opt-out:
`data-slop-allow="floating-hero-card"` on the card.

### grid-spacer-void (severity 2, FIX)

**Detects:** a grid whose effective declarations set a fixed
`grid-auto-rows` of 24px or more, and which contains a descendant that is
a thin full-span separator (`grid-column: 1 / -1` with a height of 12px
or less). The flagged class is the one actually carrying the fixed
`grid-auto-rows`.

**Why it reads as slop:** the hairline divider lands in its OWN implicit
row, so a 1px line is stretched into a 168px track: the screen renders as
content rows separated by giant empty bands. This is a genuine layout
bug, not a taste call; a fixed-row gallery with no separator child is
never touched.

```css
/* bad */
.grid { display: grid; grid-auto-rows: 168px; }
.sep  { grid-column: 1 / -1; height: 1px; }
/* good */
.grid { display: grid; grid-auto-rows: auto; }
```

**Auto-fix:** rewrites that grid's `grid-auto-rows` to `auto`, so the
divider's row collapses to its 1px content while real cells size to their
content. The divider lines survive; only the void is removed. CSS
opt-out: `--slop-allow: grid-spacer-void` in the grid's rule.

### wrap-padding-collision (severity 2, FIX)

**Detects:** an element that carries BOTH the page's inset container
class (detected by signature: horizontally centered via
`margin-inline: auto` or equivalent, plus a non-zero inline padding,
never by name) AND another class whose rule zeroes horizontal padding (a
`padding: V 0` shorthand, `padding-inline: 0`, or `padding-left/right:
0`).

**Why it reads as slop:** at equal specificity the later rule wins, so
the section's `padding: 64px 0` silently clobbers the container's
`padding-inline` and the band runs flush to the screen edge. Another
genuine bug: the author wanted vertical rhythm and accidentally deleted
the page gutter.

```css
/* bad */
.wrap { max-width: 1100px; margin-inline: auto; padding-inline: 24px; }
.band { padding: 64px 0; }   /* zeroes .wrap's gutter on the same element */
/* good */
.band { padding-block: 64px; }
```

**Auto-fix:** strips the horizontal zeros from the offending class's rule
(`padding: V 0` becomes `padding-block: V`), so the container's inset
survives and the vertical rhythm is preserved. If a band is intentionally
full-bleed, omit the container class instead. CSS opt-out: `--slop-allow:
wrap-padding-collision` in the zeroing rule.

### body-display-contents (severity 2, FIX)

**Detects:** `display: contents` applied to `<body>`, either inline
(`<body style="display:contents">`, duplicates included) or via a
`body{}` CSS rule (selector lists like `html, body {}` count; descendant
selectors like `body .child {}` do not).

**Why it reads as slop:** a `display: contents` body generates no box, so
its padding, width, and flex gap are ALL discarded: the screen renders
with no side padding, content under the status bar, and zero section
rhythm. `display: contents` is legitimate on a nested wrapper `<div>`,
never on body.

```html
<!-- bad -->
<body style="display: contents">
<!-- good -->
<body>
```

**Auto-fix:** strips the `display: contents` declaration from body inline
styles and `body{}` rules; every other declaration is left intact. CSS
opt-out: `--slop-allow: body-display-contents` in the same declaration
block.

### hscroll-snap-gutter (severity 1, BASE)

**Detects:** a horizontal scroll-snap container (`overflow-x: auto|scroll`
plus `scroll-snap-type` on the x/inline/both axis) whose side gutter
comes from its OWN non-zero inline padding, with no `scroll-padding*`
declared.

**Why it matters:** the snapport is the scrollport minus `scroll-padding`
(default 0), and the container's padding sits outside it, so
`scroll-snap-align: start` under mandatory snap rests the first card
flush to the edge: the leading gutter vanishes and the last card collides
with the right edge. BASE tier: a carousel without the fix is not "slop",
so it never affects the verdict, but the fix is free and always correct.

```css
/* bad */
.carousel { overflow-x: auto; scroll-snap-type: x mandatory; padding: 0 16px; }
/* good */
.carousel { overflow-x: auto; scroll-snap-type: x mandatory; padding: 0 16px;
            scroll-padding-inline: 16px; }
```

**Auto-fix:** appends `scroll-padding-inline` mirroring the resolved
inline padding (handles the `padding` shorthand, logical properties, and
source order). Abstains when there is no non-zero inline padding to
mirror. CSS opt-out: `--slop-allow: hscroll-snap-gutter`.

---

### hero-kicker-eyebrow (severity 1, FIX)

**Detects:** two shapes above the page's primary prose `<h1>`: (a) the
element immediately preceding the H1, and (b) the standalone block
immediately preceding the hero's top-level section. Either fires only
when it is short (60 chars / 9 words max, contains letters), reads as an
eyebrow (uppercase text, `text-transform: uppercase`, or letter-spacing
at 0.08em/1px+ anywhere in its subtree), is not itself a heading, and
contains no links, lists, nav, buttons, forms, or images, so a real top
nav, promo bar, or toolbar is never touched. Eyebrows above section-level
`h2`s are deliberately left alone.

**Why it reads as slop:** the tiny tracked badge above the headline is
the most-cited generated-landing tell there is. It restates or merely
locates the title, spending the page's first pixels on chrome.

```html
<!-- bad -->
<p class="eyebrow">MAISON NOIR · ATELIER DE SOIN · MMXXV</p>
<h1>Skin is a living archive of light.</h1>
<!-- good -->
<h1>Skin is a living archive of light.</h1>
```

**Auto-fix:** removes the eyebrow element(s). Element opt-out:
`data-slop-allow="hero-kicker-eyebrow"`.

---

### reveal-specificity-trap (severity 3, FIX)

**Detects:** per `<style>` block: every class hidden behind a JS gate
(`.js .reveal` or `html.js .reveal` with `opacity: 0`) whose revealed
state is then written WITHOUT the gate, as a compound selector starting
with that class (`.reveal.in`, `.step.in.late`). Descendant forms and
already-gated selectors are left alone.

**Why it reads as slop:** it is not taste, it is a bug that blanks the
page. `html.js .reveal` (specificity 0-2-1) beats `.reveal.in` (0-2-0)
forever, so the IntersectionObserver adds the class and nothing appears:
hero renders, everything below stays at opacity 0. Severity 3 because
the failure is total.

```css
/* bad */
html.js .reveal { opacity: 0 }
.reveal.in { opacity: 1 }
/* good */
html.js .reveal { opacity: 0 }
html.js .reveal.in { opacity: 1 }
```

**Auto-fix:** prefixes each ungated revealed selector with `html.js `,
tying the specificity so source order wins. Idempotent by construction:
rewritten selectors no longer match the trap pattern.

---

### row-kicker-eyebrow (severity 2, FLAG)

**Detects:** within any group of 2+ repeating sibling rows (same tag +
leading class, each with real text), rows whose text runs contain a short
ALL-CAPS multi-token kicker ('LOCAL FAVORITE · 96 RAVING') BEFORE a
lowercase title-like run. Fires only when 2+ rows in the group carry the
pattern, so one deliberate label never trips it.

**Why it reads as slop:** a list where every item wears a status eyebrow
buries the actual titles under repeated shouting. The eyebrow slot
belongs to the section header, once.

**Advisory (FLAG):** no auto-fix and no verdict impact. On an app feed
this is a real defect; on a marketing page a kicker-led card grid can be
the genre, and a static detector cannot tell which page it is on.
Element opt-out: `data-slop-allow="row-kicker-eyebrow"` on the row.

---

### multiline-row-meta (severity 2, FLAG)

**Detects:** in repeating row groups, a row holding either a leaf element
whose content opens with a quotation mark (a review/pull-quote) or a
`<br>` outside a heading (a hand-wrapped meta line). Both are proxies for
"this cell will wrap to 2+ lines beside single-line neighbors" that a
static pass can check without layout.

**Why it reads as slop:** one wrapping quote snaps the vertical rhythm of
the whole list; rows stop scanning as rows. Quotes live on detail
screens; list meta is one truncated line.

**Advisory (FLAG):** reported, never counted. A testimonial list is the
one genre where per-row quotes are the point. Opt out per row with
`data-slop-allow="multiline-row-meta"`.

---

### overstuffed-row (severity 2, FLAG)

**Detects:** in repeating row groups, rows whose info-slot count (visible
text runs + media, where media means `<img>` or a non-icon `<svg>`:
icon-marked, icon-classed lucide/feather/tabler/heroicons/etc., and
canvases at 32 or under are exempt) exceeds 4. Fires only when 2+ rows in
the group are over budget.

**Why it reads as slop:** thumbnail + kicker + title + location + quote +
mini-viz in every row is density without hierarchy: nothing can be
scanned when everything is present. Three slots (subject, title, one
decision metric) is what a row can actually carry.

**Advisory (FLAG):** no verdict impact; rich marketing tiles legitimately
run denser. Opt out per row with `data-slop-allow="overstuffed-row"`.

---

### row-as-card (severity 1, FLAG)

**Detects:** groups of 3+ repeating rows where each row has a thumbnail
or media, 2+ text runs, AND a card surface (border-radius plus a fill,
shadow, or border) resolved from its classes and inline styles.

**Why it reads as slop:** carding every uniform row floats a plain list
on a sea of gaps and borders. Divider-separated rows read faster and
quieter; per-item cards are for genuinely rich, differentiated tiles.

**Advisory (FLAG):** genre-dependent by nature (a product-card grid is
carded on purpose), so it reports without affecting the verdict. Opt out
per row with `data-slop-allow="row-as-card"`.

---

### nested-cards (severity 1, GATE)

**Detects:** a card-surfaced CONTAINER (radius plus fill/border resolved
from classes + inline styles, holding a heading/paragraph or 2+ element
children) with an ancestor that is also card-surfaced. Chips, badges,
buttons, and links never qualify as the inner card.

**Why it reads as slop:** when every level of a region carries its own
radius, fill, and edge, surface depth stops encoding anything: the
telltale generated dashboard where panels hold panels holding panels.

**Detect-only (GATE):** un-nesting means choosing which surface to keep,
a real layout decision. Group inner content with spacing and hairlines,
or lift the inner card out. Element opt-out:
`data-slop-allow="nested-cards"` on the inner container.

---

### numbered-section-markers (severity 1, FLAG)

**Detects:** two or more leaf elements whose entire text is a
leading-zero index (`01`, `02.`, `03/`). A single marker, or plain
unpadded digits, never fires.

**Why it reads as slop:** 01/02/03 scaffolding stamped on sections whose
order encodes nothing is template structure left visible: numbering as
decoration rather than sequence.

**Advisory (FLAG):** real steps, timelines, and ranked lists number
their sections legitimately; the detector cannot know whether order is
content, so it reports without gating.

---

### icon-topped-feature-card (severity 1, FLAG)

**Detects:** three or more repeating sibling cards that each open with a
lone icon (an svg/img first child, bare or in an empty wrapper) followed
by a heading (h2-h5) and a paragraph.

**Why it reads as slop:** icon-heading-blurb times three is the most
recycled section structure in generated landings, the layout equivalent
of lorem ipsum: it fills the "features" slot without deciding anything.

**Advisory (FLAG):** it is also a working convention real sites use, so
it reports for judgment. Vary the geometry, lead with evidence, or opt
out per card with `data-slop-allow="icon-topped-feature-card"`.

---

## Motion

### transition-all (severity 1, GATE)

**Detects:** a `transition` or `transition-property` declaration whose
value contains the keyword `all` (vendor prefixes included), in a `<style>`
rule body or inline style.

**Why it reads as slop:** `transition: all` animates every property that
happens to change, including layout, color, and shadow you never meant to
move. It is the lazy default behind janky hovers, and it forces the browser
to watch everything. Motion should name its subject.

```css
/* bad */
.card { transition: all 0.3s ease; }
/* good */
.card { transition: transform 200ms ease-out, opacity 200ms ease-out; }
```

**Detect-only because:** the tool cannot know which properties you meant to
animate; narrowing the list is a design decision. Make it explicitly, then
re-run the check. CSS opt-out: `--slop-allow: transition-all`.

---

### will-change-misuse (severity 1, FIX)

**Detects:** any `will-change` declaration (style blocks + inline styles)
naming a property outside the compositable set: `transform`, `opacity`,
`filter`, `clip-path` (plus the spec values `scroll-position`,
`contents`, and CSS-wide keywords). `will-change: all`, `top`, `width`,
`background`, `box-shadow`, and friends all fire.

**Why it reads as slop:** `will-change` only helps properties the
compositor can own. Pointed at layout or paint properties it allocates a
GPU layer that cannot accelerate anything: memory spent, zero motion
gained, the copy-paste residue of a performance cargo cult.

```css
/* bad */  .card { will-change: top, box-shadow }
/* good */ .card { will-change: transform }
```

**Auto-fix:** keeps any compositable properties from the list and drops
the rest; a declaration left empty is removed entirely (it is a pure
hint, so appearance never changes). Opt out per block with
`--slop-allow: will-change-misuse`.

---

### bounce-easing (severity 1, FIX)

**Detects:** any `cubic-bezier()` whose y-coordinates leave the 0-1 range
(overshoot/elastic curves) in transitions or animations.

**Why it reads as slop:** interfaces settle; toys bounce. The spring-in
dialog with visible overshoot is a demo-reel flourish that makes
production UI feel wobbly and slow.

**Auto-fix:** replaces the overshoot curve with `ease-out`, preserving
the rest of the shorthand. Opt out per block with
`--slop-allow: bounce-easing`.

---

### layout-prop-animation (severity 1, GATE)

**Detects:** `transition` / `transition-property` values naming layout
properties: width, height, max-width/height, top/left/right/bottom,
inset, margin, padding. Transform/opacity transitions never match;
`transition: all` is transition-all's finding.

**Why it reads as slop:** every animated frame of a layout property
reflows the page, so the motion stutters exactly where it tries to
impress. The compositor can only own transforms, opacity, and filters.

**Detect-only (GATE):** the right rewrite depends on intent (translate
instead of top, grid-template-rows or a measured transform instead of a
height accordion), so removing the transition blindly would break real
behavior. Opt out per block with `--slop-allow: layout-prop-animation`.

---

### hover-scale-image (severity 1, FLAG)

**Detects:** a `:hover` rule on an image-ish selector (img, image, thumb,
photo, media, cover, card) whose transform scales above 1.

**Why it reads as slop:** the hover zoom is the one effect everyone has
seen, applied by reflex to every card and thumbnail. Ubiquity is the
tell: it signals "default interaction" rather than a designed response.

**Advisory (FLAG):** a restrained, deliberate zoom is a legitimate
choice; this reports so the choice gets made. Opt out per block with
`--slop-allow: hover-scale-image`.

---

## Copy

### cents-suffix (severity 1, FIX)

**Detects:** a price (a currency-prefixed number or a comma-grouped figure)
immediately followed by a `<span>` containing one or two digits (with an
optional leading dot): the classic superscripted decimal.

**Why it reads as slop:** `$28,461` with a floating little `.20` is
screen-recording verisimilitude misapplied to a mockup. Design comps use
whole, intentional numbers; fake precision reads as generated dashboard
filler.

```html
<!-- bad -->
<div class="metric">$28,461<span class="cents">.20</span></div>
<!-- good -->
<div class="metric">$28,461</div>
```

**Auto-fix:** collapses the suffix span, keeping the base figure.

### oversized-number (severity 1, FIX)

**Detects:** a numeric value of 10,000 or more rendered raw in visible text
(comma-grouped or 5+ digits), with or without a currency symbol. Numbers
already suffixed with `%`, `K`, `M`, or `B` are spared.

**Why it reads as slop:** `$1,842,000` typeset raw overflows metric cards
and reads as a database dump. Designed dashboards abbreviate magnitude so
the number stays scannable.

```html
<!-- bad -->
<div class="stat">$1,842,000</div>
<!-- good -->
<div class="stat">$1.8M</div>
```

**Auto-fix:** abbreviates to K/M/B with at most one decimal
(`1,842,000` becomes `1.8M`). Values 9,999 and under stay raw digits.

### em-dash-copy (severity 1, FIX)

**Detects:** a single em dash (U+2014, raw or as `&mdash;` / `&#8212;` /
`&#x2014;`) in visible copy, or an en dash used with spaces around it as an
em-dash substitute. Runs of two or more dashes belong to
`decorative-divider`; unspaced en-dash ranges (`Mon-Fri`, `9-5`) are
legitimate and spared.

**Why it reads as slop:** the mid-sentence em dash is the most recognizable
generated-TEXT tell there is. Interface copy is short; it wants commas,
colons, and periods, not essayistic asides.

```html
<!-- bad -->
<p>Ship faster &mdash; without the busywork.</p>
<!-- good -->
<p>Ship faster, without the busywork.</p>
```

**Auto-fix:** replaces the dash (and its surrounding spaces) with a comma
and a space; a dash that opened a text node is dropped without leaving a
stray comma.

### lorem-ipsum (severity 2, GATE)

**Detects:** the phrases `lorem ipsum` or `dolor sit amet` (case
insensitive) in visible text.

**Why it reads as slop:** filler copy in a finished screen means the design
was never finished. Realistic domain copy is half of what makes a mockup
feel designed; lorem ipsum is an abandoned template wearing your layout.
Severity 2 because shipping it is always wrong.

```html
<!-- bad -->
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
<!-- good -->
<p>Track every shipment from pickup to doorstep, in one timeline.</p>
```

**Detect-only because:** no tool can write your product's copy. Replace it
with short, specific text in the product's own domain, then re-run.

### viz-redundant-scale (severity 1, FIX)

**Detects:** inside an arc/gauge `<svg>` whose surrounding container
already shows the scale on the value (a `7/10` ratio, or a percent, which
implies 100), a PAIR of `<text>` endpoint labels reading exactly `0` and
`N` that horizontally SPAN the arc (one within the leftmost 20% of the
viewBox width, one within the rightmost 20%). Neither may be the hero
value itself (resolved font-size over 20px, or positioned in the center
region). A one-sided y-axis never spans, so it is spared; an svg with no
readable viewBox is skipped entirely.

**Why it reads as slop:** the gauge states its scale twice. Once the
value carries the denominator (`7/10`), rim labels `0` and `10` are
redundant chrome that a generated gauge adds because real gauges
"usually have numbers there".

```html
<!-- bad: value says 7/10 AND the rim says 0 ... 10 -->
<div><svg viewBox="0 0 100 60"><path d="M10 50 A40 40 0 0 1 90 50" fill="none"/>
  <text x="5" y="58">0</text><text x="95" y="58">10</text></svg><strong>7/10</strong></div>
<!-- good -->
<div><svg viewBox="0 0 100 60"><path d="M10 50 A40 40 0 0 1 90 50" fill="none"/></svg><strong>7/10</strong></div>
```

**Auto-fix:** removes the redundant endpoint pair. Descriptive endpoint
labels (TODAY / GOAL) never match and always survive. Element opt-out:
`data-slop-allow="viz-redundant-scale"` on the `<svg>`.

### live-clock-eyebrow (severity 1, FIX)

**Detects:** a small element (span/div/p/small/em/strong/b/i/time/label/
h6/figcaption) whose ENTIRE visible text is a `LIVE` or `NOW` token,
optionally preceded by a status dot/bullet and optionally followed by a
separator plus a clock time (`HH:MM`, with or without am/pm). The
whole-text equality is the safety: a "LIVE STREAM setup" heading, a
"Departs 09:41" row, or any time not fronted by LIVE/NOW never matches.
Outermost match only, so a flagged badge is removed once, cleanly.

**Why it reads as slop:** the device status bar already shows the time,
and a "LIVE" dot badge on a mockup is decorative urgency. Together
("LIVE 09:41") they are a generated-dashboard eyebrow that asserts
liveness no data supports.

```html
<!-- bad -->
<span class="eyebrow">● LIVE · 09:41</span>
<!-- good: nothing; the status bar shows the time -->
```

**Auto-fix:** removes the whole eyebrow element. Element opt-out:
`data-slop-allow="live-clock-eyebrow"` (a genuinely live broadcast badge
is a deliberate design decision).

---

### publication-masthead-block (severity 2, FIX)

**Detects:** a terse container (`div`/`header`/`aside`/`dl`/`section`/
`table`, text at most 140 chars) whose text carries at least one
NUMBERED periodical label (VOLUME/VOL., ISSUE, EDITION, CATALOGUE,
FOLIO, or a `№ N`) plus a second distinct tell: another label family or
a fabricated serial code (`HV-IDX-029`, 2+ dash-joined uppercase
groups). Containers holding real content (headings, links, controls,
media), anything inside `<footer>`/`<nav>`, bare years/dates, a single
repeated family ("Volume 1 / Volume 2"), and serial-only spec tables
("SKU AB-CD-123") are all spared.

**Why it reads as slop:** invented print metadata is pure costume: the
screen has no volume, no catalogue, no edition. It is the fastest way a
generated landing signals "editorial" without having anything editorial
about it.

```html
<!-- bad -->
<div class="hero-meta">VOL. 04 / 2024 · Catalogue HV-IDX-029 · Updated 14 MAR 2025</div>
<!-- good: nothing; the product is not a periodical -->
```

**Auto-fix:** removes the whole cluster container (outermost match), so
no orphaned label fragments remain. Runs BEFORE masthead-eyebrow so the
eyebrow rule cannot strip an inner span first and orphan the rest.
Element opt-out: `data-slop-allow="publication-masthead-block"`.

---

### masthead-eyebrow (severity 1, FIX)

**Detects:** a small element (span/small/em/strong/b/i/time/label/
figcaption/p/div) whose ENTIRE text is a numbered issue reference:
`ISSUE`/`EDITION`/`SERIAL` + number, or the dotted abbreviations
`VOL.`/`NO.` + number, with optional `№`/separators. Whole-text equality
is the safety: prose that merely contains "issue", a bare "№ 1" rank
badge, an undotted "NO 1" answer, and real headings (h1-h6 are not
eligible tags) never match. Outermost match only.

**Why it reads as slop:** software ships versions, not issues. The
VOL./№ eyebrow is print-magazine chrome pasted onto a product screen to
borrow editorial gravity it has not earned.

```html
<!-- bad -->
<span class="eyebrow">VOL. 04 · № 27</span>
<!-- good: nothing, or a real version/date the product actually has -->
```

**Auto-fix:** removes the eyebrow element. Element opt-out:
`data-slop-allow="masthead-eyebrow"` (a genuine digital magazine keeps
its issue label deliberately).

---

### benefit-speak (severity 1, GATE)

**Detects:** the marketing filler lexicon in visible text: elevate,
supercharge, streamline, empower, effortless(ly), seamless(ly),
revolutionize, game-changer/-changing, world-class, next-level, unleash,
turbocharge, and "unlock the/your/a/new". Functional uses survive:
"Unlock with Face ID" never matches. Styles, scripts, comments, and
attributes are never read.

**Why it reads as slop:** these verbs sell nothing specific; they are
placeholders where a claim should be. "Search your meeting notes" beats
"Unlock your knowledge" because it can be true.

**Detect-only (GATE):** only you know what the product actually does, so
the fix is writing the concrete claim. Quote each flagged phrase and
replace it with a specific verb + object.

---

### not-x-but-y-cadence (severity 1, FLAG)

**Detects:** the manufactured-rebuttal rhythm in a visible text run:
"it's/this is/we're not (just) X, it's Y" and its close variants.

**Why it reads as slop:** it is the single most recognized generated-copy
cadence: contrast as a tic. If the difference matters, specifics carry
it; the construction is what remains when they are missing.

**Advisory (FLAG):** occasionally a writer earns it, so it reports for
judgment rather than gating.

---

### fabricated-precision (severity 1, FLAG)

**Detects:** the invented-evidence stat shapes in visible text: 99.9% /
99.99%, 10x / 100x, "#1", and "trusted by" followed by a round crowd
(thousands, millions, 10,000+).

**Why it reads as slop:** precision without provenance is decoration.
Nobody measured the 10x; the number exists to look like evidence, and
readers have learned the pattern.

**Advisory (FLAG):** a real 99.9% SLA with a source is legitimate, so
this reports the shapes and leaves the verdict to you.

---

### apologetic-error-copy (severity 1, GATE)

**Detects:** "Oops", "Whoops", "Uh oh", and "something went wrong" in
visible text.

**Why it reads as slop:** the apologetic error is the template default
that helps no one: it names no failure and offers no next step. Errors
are guidance surfaces, not mood management.

**Detect-only (GATE):** the fix is stating what failed and what to do
("Couldn't save. Check your connection and retry."), which needs product
knowledge. Quote each occurrence and write the real message.

---

## Imagery

### broken-image (severity 1, FIX)

**Detects:** an `<img>` whose `src` is missing, empty, or a known
placeholder literal: `#`, `about:blank`, `undefined`, `null`, `todo`,
`{{template}}` mustaches, `placeholder...`, `your-image-here`, `path/to/`,
or `example.com/placeholder|img|image`. Resolver slots
(`data-photo-query`, `data-photo-placeholder`, `data-illustration`,
`data-attachment-ref`) are sanctioned: a host pipeline fills those after
generation.

**Why it reads as slop:** a broken-image glyph in a corner of a card is the
fastest way for a screen to read as generated and unreviewed.

```html
<!-- bad -->
<img src="path/to/hero.jpg">
<!-- good -->
<img src="https://images.unsplash.com/photo-15060..." alt="Alpine ridge at dawn">
<!-- also fine: a resolver slot a pipeline will fill -->
<img data-photo-query="alpine ridge dawn" alt="">
```

**Auto-fix:** removes the broken `<img>` element entirely; a missing image
beats a broken one. Element opt-out: `data-slop-allow="broken-image"`.

### missing-alt (severity 1, FIX)

**Detects:** an `<img>` with no `alt` attribute at all. Resolver slots are
skipped (the pipeline that fills the `src` owns the `alt` too), and images
already flagged as broken are left to `broken-image`.

**Why it reads as slop:** without `alt`, a screen reader announces the raw
filename. Even `alt=""` (explicitly decorative) is a decision; silence is
the absence of one.

```html
<!-- bad -->
<img src="team/ana.jpg">
<!-- good -->
<img src="team/ana.jpg" alt="Ana Ruiz, head of design">
<!-- good, decorative -->
<img src="texture.png" alt="">
```

**Auto-fix:** adds `alt=""` (the safe decorative default). Upgrade
meaningful images to a real description yourself; the tool cannot know what
the image shows.

### placeholder-image (severity 1, GATE)

**Detects:** an `<img>` whose `src` points at a stock placeholder service:
`i.pravatar.cc`, `randomuser.me`, `ui-avatars.com`, `api.dicebear.com`,
`placekitten.com`, `placehold.co`, `via.placeholder.com`, `placeimg.com`,
`dummyimage.com`, `fakeimg.pl`, `lorempixel.com`, `loremflickr.com`,
`picsum.photos`, or `source.unsplash.com` (a shut-down endpoint). Real
photo CDNs (`images.unsplash.com`, `images.pexels.com`) are not flagged.

**Why it reads as slop:** placeholder-service imagery is lorem ipsum for
pictures: the screen was never finished with real assets, and some of these
services rotate or die, so the design changes under you.

```html
<!-- bad -->
<img src="https://i.pravatar.cc/150?img=3" alt="avatar">
<!-- good -->
<img src="team/ana.jpg" alt="Ana Ruiz">
```

**Detect-only because:** choosing the real asset is your call. Element
opt-out: `data-slop-allow="placeholder-image"` (e.g. a deliberate
avatar-generator integration).

---

### image-outline (severity 1, BASE)

**Detects:** a full document containing `<img>` elements but no
`<style id="gesso-image-outline">` polish block.

**Why it matters:** a photo sitting flush on the surface has no edge:
light image regions dissolve into light grounds and the layout loses its
shape. A 1px inset hairline in PURE black or white at 5% alpha defines
the edge invisibly; a tinted near-black or accent-colored outline reads
as dirt.

```css
img { outline: 1px solid rgba(0,0,0,0.05); outline-offset: -1px }
```

**Auto-fix:** injects one marked block targeting content images
(`data-illustration`/`data-icon`/`aria-hidden` images are excluded).
The hairline color is picked from the page's own ground: a body/html
background hex with luminance under 0.5 gets the white hairline,
anything else black. `outline` + `outline-offset:-1px`, so layout never
shifts. Idempotent on the block id; opt a document out by shipping your
own (even empty) `<style id="gesso-image-outline">`.

---

## Quality

### justified-text (severity 1, FIX)

**Detects:** `text-align: justify` anywhere in styles.

**Why it reads as slop:** browsers justify without proper hyphenation, so
justified UI copy grows uneven "rivers of white" between words. Books earn
justification with hyphenation engines; interfaces do not.

```html
<!-- bad -->
<p style="text-align: justify">...</p>
<!-- good -->
<p style="text-align: left">...</p>
```

**Auto-fix:** rewrites to `text-align: left`.

### missing-lang (severity 1, FIX)

**Detects:** an `<html>` element with no `lang` attribute.

**Why it reads as slop:** screen readers use `lang` to pick a
pronunciation engine; without it, assistive tech guesses. It is the
one-attribute difference between a page and a document.

```html
<!-- bad -->
<html>
<!-- good -->
<html lang="en">
```

**Auto-fix:** adds `lang="en"`. Change it if the page is not English; the
fixer cannot detect the language of your copy.
