# CLAUDE.md

Short-form Excel tutorial reels for accountants, published under the handle
**smbsolved** on Instagram / TikTok / YouTube Shorts, and on LinkedIn from the
founder's personal profile. The channel exists to build authority that funnels
into SMB Solved (fractional controller + internal tools) and Steda (fixed-asset
register for QuickBooks).

One person runs this. Every decision below exists to keep output consistent
across dozens of reels without a human tuning each one. Strategy, evidence and
the target architecture live in the strategy document (2026-08-22); the
reasoning behind each rule is in `DECISIONS.md`.

---

## The one rule

**Nothing renders that has not been verified in real Excel.**

`pipeline/verify.ts` recalculates every formula in the installed Excel (COM,
`pipeline/excel.ts`) on every build. What Excel *displays* must equal
`expected` exactly — error values included — and the formula Excel stores must
equal the text the script typed. A pass writes a `verification` record into
the reel JSON; it is informational, the build reruns Excel regardless. The
build exits non-zero otherwise. There is no bypass flag. Do not add one. Do
not "fix" a failing verification by loosening the check.

Consequence: the build machine is Windows with Excel, in an interactive user
session (Office COM does not run from services). Schedule with Task Scheduler
"run only when user is logged on".

The audience is accountants. A wrong formula costs more credibility than
fifty correct reels earn.

---

## Architecture

```
content/reels/NNN-slug.json   the reel, as data. the only file that changes per reel
content/backlog.md            topic queue (symptoms, written by hand or mined)
src/reel/                     Remotion composition. changes rarely
pipeline/                     plain scripts, run in order
pipeline/excel/recalc.ps1     drives Excel via COM; invoked by excel.ts
prompts/                      LLM prompts for the writer and reviewer
public/audio/                 generated VO + alignment, gitignored, archived
out/                          finished MP4s, gitignored
```

Around the daily pipeline sit two more pieces: `mine.ts` (weekly topic miner:
Stack Exchange in, tagged backlog candidates out under "## Mined"; a human
promotes by giving an item a number) and `template-far.ts` (lead-magnet
templates built by real Excel and verified against an independent TypeScript
computation before publishing).

Pipeline order (`run.ts` chains them for one scheduled run):

1. `script.ts`   writer model turns a backlog topic into reel JSON;
                 loops on verify + reviewer findings, ≤3 times, then parks   (judgment)
2. `verify.ts`   structure checks + recalculation in real Excel (`excel.ts`) (deterministic)
3. `review.ts`   reviewer model checks claims, version caveats, data,
                 hook, variety — never the formula result                  (judgment)
4. `voice.ts`    ElevenLabs with-timestamps, writes mp3 + alignment        (deterministic)
5. `render.ts`   Remotion renders MP4 + two LinkedIn stills, in-process    (deterministic)
6. `deliver.ts`  OneDrive-synced archive + Slack post with ✅ approval      (deterministic)

Models are allowed in exactly two places: the **writer** (1) and the
**reviewer** (3); both go through `llm.ts`, both return structured JSON
against a zod schema. Steps 2, 4, 5, 6 stay model-free. If a deterministic
step feels like it needs judgment, the reel JSON is underspecified — fix the
schema. `.env.local` holds the keys (`env.ts` loads it); never commit it.

---

## Timing is derived, never hardcoded

Animation beats are anchored to voiceover timestamps, not to absolute seconds.

Each line in `script[]` may carry a `cue`. ElevenLabs returns character-level
alignment for the *input* text (`alignment`, never `normalized_alignment`);
`src/reel/timeline.ts` converts that into a frame window per cue. The formula
finishes typing exactly when the narration finishes saying it.

Consequence: rewriting a line automatically retimes the animation. Never patch
timing by editing frame numbers in the composition.

Valid cues, in the order they normally appear:

| cue | what happens |
|---|---|
| `hook` | full-bleed overlay, no sheet |
| `revealTop` | rows 1-4 stagger in |
| `revealBottom` | rows 7-10 stagger in |
| `typeFormula` | formula types into the bar, char by char |
| `showError` | result lands in the target cell, shake, red |
| `markError` | red audit circle strokes on |
| `showAlignment` | TEXT / NUMBER pills appear in column C beside the two cells |
| `typeFix` | corrected formula types, changed chars highlighted |
| `showResult` | result lands, green tick strokes on |
| `fillDown` | remaining rows populate |
| `payoff` | full-bleed overlay, the takeaway |

Not every reel uses every cue. Order must not be shuffled. The cue vocabulary
is the current ceiling of what a reel can show; widening it (row/column
insertion, multi-column sheets, a second formula cell) is a schema change —
log it in `DECISIONS.md` first.

---

## Visual grammar

Locked. Changing any of this breaks recognizability across the channel.

- **Ledger green background** (`--ledger`), warm paper sheet, dark ink.
- **The sheet must be unmistakably Excel**: name box, `fx`, formula bar,
  column letters, row numbers, real error strings. Authenticity with
  accountants rides on this.
- **Audit tick marks are the signature.** Red pencil circle marks the broken
  cell. Green tie-out check marks the fixed one. Both stroke on, never fade in.
  This is the one bold element. Everything else stays quiet.
- **One accent per state.** Red = wrong, Excel green = right. No third color.
- Captions: two lines max, sentence case, 56px, weight 800, **≤28 characters
  per line**. `*asterisks*` wrap an accent-colored span. `\n` is a line break.
- **Safe box** (`SAFE` in `theme.ts`): top 270, bottom 500, left 60, right
  180, plus the action rail (x > 900, y 1100–1750). Captions start at y 1110
  and run 80–900px wide. Nothing that carries meaning goes outside the box.
  Run `npm run dev` and toggle the safe-area guide before shipping anything.
- No transitions between beats. No zooms, no whooshes, no kinetic type.
- Fonts must be bundled in `public/fonts` and loaded with `@remotion/fonts`
  `loadFont()`; headless Chrome has no system fonts and a fallback silently
  changes the render.

---

## Writing rules

- The hook is a problem the viewer has personally had at 9pm during close,
  stated in ≤10 on-screen words. Generic ("5 Excel tips!") is a rewrite, not
  a note. The fix starts by ~5 seconds.
- **Reads like a person.** Contractions, plain verbs, uneven sentence
  lengths. No em/en dashes anywhere a viewer sees or hears text (the gate
  rejects them), no semicolons or colons in captions, no "it's not X, it's
  Y", no two captions in a row with the same shape. The bar: would a
  controller text this line to a coworker.
- Function names and error values are written as Excel shows them (`SUMIFS`,
  `#N/A`) everywhere; `src/reel/speech.ts` rewrites them for the voice
  (`#N/A` is spoken "N A"). Pronunciation problems are lexicon entries, not
  script rewrites.
- One reel a week is a `[general]` tip: plain Excel for anyone in a
  spreadsheet, hook aimed at any office worker, everyday-but-real data
  allowed. Same grammar, same verification, still a before/after formula.
- Never more than one concept per reel.
- Say the fix out loud in plain words before showing the formula.
- Data must look like real accounting data: GL exports, account codes,
  chart of accounts, AP aging, trial balance. Never `Product A / 100 / 200`.
- Prefer problems caused by *data coming out of an accounting system*. That
  is the ground generic Excel accounts do not cover and the reason someone
  follows this one.
- Length band is 30–55s. The beat sequence decides; never pad, never rush.
- Vary the narration across reels. The visual grammar is a template by
  design; the words must not be (YouTube's inauthentic-content policy targets
  mass-produced sameness).
- No CTA in tutorial reels. The profile/bio carries the funnel. Roughly one
  in five reels may reference Steda or consulting, only where it is genuinely
  the answer, and only in the payoff line — never a pitch.
- Description text: first line is the search phrase an accountant would type,
  then one plain sentence, then ≤5 topical hashtags.
- Voice ID, model (`eleven_multilingual_v2`), voice settings and seed are
  fixed in `.env` and do not change between reels. Consistency beats quality
  here. Never Flash models — they do not normalise numbers.

---

## Platform notes

- One clean MP4 for every platform. No watermarks, no re-downloads.
- Cadence (evidence in the strategy document): Instagram / TikTok / Shorts
  3–4 reels a week, the same reel everywhere, and one of them is the weekly
  `[general]` tip; LinkedIn 2 posts a week from the founder's profile — one
  native reel, one static frame or text post — never two within 24 hours,
  plus 10–15 minutes a day of commenting. Never a zero week on any platform;
  a skipped week costs more than a lighter one.
- Burn captions in; switch off the platform's auto-captions on the post.

---

## Conventions

- TypeScript everywhere. One runtime, because Remotion requires Node anyway.
- Reel JSON is validated by zod (`src/reel/schema.ts`). Schema is the contract
  between the writer and the renderer. Widen it deliberately, never ad hoc.
- 1080x1920, 30fps.
- Log decisions in `DECISIONS.md` when you change the grammar, the schema, the
  gate, or the scope. Append-only.

---

## Not built yet, by decision

Each needs a reason in writing in `DECISIONS.md` before it starts:

- auto-posting (order if it comes: YouTube → Instagram → LinkedIn → TikTok, or
  a scheduler with an API). Until then: deliver to Slack/OneDrive, post by hand.
- a web UI
- a second content format (LinkedIn static before/after frames and lead-magnet
  templates are on the table; see the strategy document)
