# Decisions

Append-only. Log anything that changes the visual grammar, the schema, or the
scope. If a future change contradicts an entry here, add a new entry rather
than editing the old one.

---

## 2026-08-22 — Remotion over screen recording
Excel tutorials could be recorded from real Excel and automated with
pywinauto/OBS. Rejected: timing drift, unexpected dialogs, and resolution
dependence make it silently fragile. Rendering a spreadsheet in code gives
cell-perfect consistency and a look that is ours. Authenticity traded for
repeatability, deliberately.

## 2026-08-22 — Audit tick marks as the signature
Red pencil circle on the broken cell, green tie-out check on the fixed one.
Drawn from accounting practice rather than motion-graphics convention. This is
the one bold element; everything else stays quiet. Do not add a third accent
color.

## 2026-08-22 — Timing derived from voiceover, never hardcoded
Animation beats anchor to ElevenLabs character timestamps. Rewriting a line
retimes the animation automatically. Cost: a render requires audio, or falls
back to word-count estimates in the studio.

## 2026-08-22 — Two scripts, no agents
Only script generation calls a model. Verification, voice, render, and mux are
deterministic and stay as plain functions. Revisit only if a step starts
needing judgment over messy input.

## 2026-08-22 — Published under smbsolved, not the product name
The product is being renamed. Building an audience on a handle that is about to
change would be an avoidable mistake. Consulting inquiries arriving through this
channel land on the right brand anyway.

## 2026-08-22 — No auto-posting in v1
Graph API auth is the most annoying piece with the least payoff at three reels a
week. Output MP4s, post from the phone. Revisit above roughly daily volume.

## 2026-08-22 — The gate is real Excel via COM, not a human flag
LibreOffice was the recalculation proxy and `verifiedInExcel: true` was a human
attestation. Both are gone. `pipeline/excel.ts` drives the installed Excel
(COM automation, hidden) from `verify.ts` on every build: the sheet and both
formulas go into a scratch workbook with no cached values, Excel calculates,
and what Excel *displays* must equal `expected` character for character,
error values included. Excel also hands back the formula as it stored it; if
that differs from what the script typed (Excel silently auto-closes a missing
parenthesis, for instance) that is an error, because the viewer retypes what
they see. A pass writes a `verification` record into the reel JSON (Excel
build, date, hash of sheet+formulas). It is informational — the build reruns
Excel regardless — so a stale or hand-edited stamp buys nothing. There is no
bypass; `--structure-only` reports "not verified" as an error. Cost: the build
machine is Windows with Excel, in an interactive user session (Office COM is
unsupported from services / Session 0), so scheduling is Task Scheduler "run
only when user is logged on". `xlsx` dependency removed. Cloud fallback if the
box ever goes away: Microsoft Graph Excel REST (same calc engine; needs
OneDrive for Business). Never HyperFormula or formulajs as the gate — partial
coverage, GPL, unverified coercion.

## 2026-08-22 — ElevenLabs: `alignment`, multilingual_v2, pinned settings, seed
`voice.ts` preferred `normalized_alignment`. Per the ElevenLabs docs that stream
is keyed to the *normalized* text (numbers expanded to words) while
`timeline.ts` slices by the input text's character count — every beat after
the first expanded token would drift. Switched to `alignment`.
`eleven_turbo_v2_5` is deprecated → `eleven_multilingual_v2`, the stable default
for with-timestamps. Flash v2.5 is excluded: it does not normalise numbers by
default and we narrate account codes. Voice settings are pinned and a fixed seed
is passed. Every mp3 + alignment JSON is archived; an old reel is never
regenerated under a newer model.

## 2026-08-22 — Safe zone is the cross-platform union; captions moved up
The old guide (top 230 / bottom 400, captions y 1220–1520) was Instagram-only.
TikTok covers the bottom 484px; every platform's action rail covers the right
~180px from roughly y 1100–1750. New `SAFE` = top 270 / bottom 500 / left 60 /
right 180 plus the rail band. Captions start at y 1110, run 80–920px wide, max
~30 chars per line at 56px/800 (verify warns above). Alignment pills moved
outside the sheet card — inside, they sat on top of column B. Overlays lifted
80px so body text clears the rail. If a reel is ever boosted as a Meta ad the
bottom margin is 672; that is not designed for.

## 2026-08-22 — Render in-process with @remotion/renderer
`execFileSync('npx', …)` is ENOENT on Windows (npx is npx.cmd), and the
`shell:true` workaround needs argument escaping. `pipeline/render.ts` bundles
once and renders through the programmatic API; `build.ts` calls it. Remotion
is free for companies of up to three people; declare `licenseKey:
"free-license"` when upgrading to 5.x.

## 2026-08-22 — Scope reopened: writer + reviewer agents, cloud hand-off, LinkedIn
Owner's brief: agents generate topics, write, review for accuracy, and deliver
the finished MP4 to the cloud for a human to approve and post. This supersedes
"Two scripts, no agents" in spirit, with a boundary: the deterministic core
(verify → voice → render) stays model-free. Models are allowed in exactly two
places — a *writer* (backlog topic → reel JSON) and an independent *reviewer*
(checks the narration's claims, Excel-version caveats, data realism, and the
hook) — and the writer loops on the verifier's findings. Delivery: Slack
(phone preview) + OneDrive (archive). LinkedIn, from the founder's personal
profile, is a first-class target alongside Reels/TikTok/Shorts because that is
where controllers and owners are. Auto-posting remains out until reels are
flowing; the evidence-backed order if it comes is YouTube → Instagram →
LinkedIn → TikTok (or a scheduler with an API). Rationale and sources in the
strategy document (2026-08-22).

## 2026-08-23 — Cadence: 3–4/wk short-form, 2/wk LinkedIn
Owner proposed 3–4/wk on Instagram/TikTok/Shorts and 1/wk on LinkedIn.
Evidence (Buffer 2.1M IG posts, 11.4M TikTok posts, 2M+ LinkedIn posts; Metricool
2026; vidIQ 10.2M channels; van der Blom 2026): 3–4/wk is inside the effective
band on all three short-form platforms and the measured penalty is for skipped
weeks, not for "only" 3–4. On LinkedIn, 1/wk is the baseline below the reach
"switch" (1 → 2–5/wk ≈ +1,200 impressions/post); van der Blom's 2026 optimum is
2–4/wk with ≥24h between posts and daily commenting. Adopted: 3–4/wk short-form
(same reel), 2/wk LinkedIn (one native reel, one static frame/text, ≥24h
apart), 10–15 min/day commenting, LinkedIn Newsletter 2/month counting as a
post. Fallback on a bad week: 2/wk everywhere, never zero.

## 2026-08-23 — Voice: ElevenLabs "Default" voices expire; pick from the permanent set or clone
The 21 premade voices visible in the account (Adam, Brian, Daniel, Matilda,
Eric, River, Sarah, George, …) are ElevenLabs "Default" voices that expire
31 Dec 2026 and are replaced by "similar, not 1-to-1" voices — they cannot
honour "one voice forever". Community-library voices can be withdrawn at any
time. Two acceptable paths: (a) one of ElevenLabs' own permanent named voices
(Caleb "Trusted Guide", Lawrence "Bright and Informative", Eddie "Natural and
Helpful", Elara "Crisp Pro Narrator" / "Warm Intellectual" — owner account
64cbc624…), or (b) a clone of the founder's own voice (IVC now on Starter,
recorded PVC-ready; upgrade on trigger). Decision pending the owner's ear;
samples in `out/voice-samples-permanent/`. Settings pinned either way: model
`eleven_multilingual_v2`, style 0, stability ~0.5, similarity ~0.75, seed.

## 2026-08-23 — The voice is "Jimmy Voice", the founder's clone; backup is Eddie
Owner cloned their own voice in ElevenLabs (IVC on Starter). Primary
`ELEVENLABS_VOICE_ID` is the clone; documented backup is Eddie — Natural and
Helpful, one of ElevenLabs' permanent named voices. Switching to the backup
(clone artifacts, account issues) is a logged decision, not a tweak. Keep the
original recording session archived: it is the re-clone insurance and the PVC
dataset if the upgrade trigger hits (>30K credits/mo, audible artifacts in
more than 1 in 10 reels, or traction worth protecting).

## 2026-08-24 — Voice confirmed; column widths follow the content
Owner signed off on "Jimmy Voice" across reels 001/002/004 — the voice is
locked (backup Eddie unchanged). And a viewer-facing bug from reel 004:
column A clipped "Northwind Logistics ", hiding the very trailing space the
reel teaches. Column widths are now computed per reel from the longest cell
in each column (`colWidthsFor` in theme.ts, ~15.4px/char at the 30px sheet
font, A clamped 170–430, column C fixed at 190 for the audit marks), and
`verify` warns when A + B content cannot both fit. Widths were never part of
the locked grammar; the card size, fonts and colors are unchanged.

## 2026-08-24 — Reddit reached through its public RSS feeds, no API
Reddit blocks unauthenticated JSON from this network, the owner reports
script-app API access is hard to get, and both of Anthropic's web-search
surfaces exclude reddit entirely (tested: domain-locked search returns "not
accessible to our user agent"; unrestricted `site:reddit.com` queries return
zero reddit results). What does work, tested 2026-08-24: reddit's Atom
feeds — `/r/<sub>/search.rss?q=excel` and `/r/excel/new/.rss` — serve HTTP
200 to a browser user agent. `mine.ts` fetches four feeds with a 5-second
gap (they 429 on rapid hits), parses title/link/content, and merges them
with Stack Exchange; a blocked feed is skipped, never fatal. Zero
credentials. If REDDIT_CLIENT_ID/SECRET ever land in `.env.local`, the real
API takes over automatically. Fragility accepted: if reddit closes the RSS
door too, the miner still runs on Stack Exchange and the log says which
feeds were skipped.

## 2026-08-24 — Pipeline entry points must be import-safe (incident)
Exporting `expectedCells` from template-far.ts made it importable, but its
CLI main() ran unguarded at module load, so an import quietly REBUILT the
template and overwrote the owner's hand-cleaned copies in out/ and OneDrive.
(The owner's 17:17 version survives in OneDrive version history; both cleaned
variants had passed all 41 checks moments earlier.) Fixes: every pipeline
script's CLI block is now guarded by the `process.argv[1]?.endsWith(...)`
check with a comment saying why, and `publishViaGit` lost its CommonJS
`require` calls (ReferenceError under ESM) in the same pass. Rule going
forward: a module either exports functions or runs on import, never both.

## 2026-08-24 — Say the credential once per surface; re-check edited files
Owner's note: repeating "checked in real Excel" across a page or an email
reads as filler. Rule: each surface states the verification at most once,
concretely (the 41-of-41 badge, or the verification file), and everything
else talks about what the thing does. Applied to the templates page and the
newsletter template. Second rule from the same exchange: when the owner
hand-edits a published template, the file is RE-CHECKED before republishing
(`npm run template:far -- --check <path>` opens the edited workbook in Excel,
recomputes, compares all cells to the independent TypeScript values, and only
then writes a fresh verification record). A stale verification never ships.

## 2026-08-24 — Instagram: permalinks and insights, own account, no review
Owner connected the Instagram API (Business account @smbsolved, Instagram
Login flavour, Standard Access). `pipeline/instagram.ts`: media list,
caption-overlap permalink matching, and token refresh that rewrites
`.env.local` (long-lived tokens last 60 days; the newsletter run refreshes,
so it never lapses). The newsletter now prefers reels that are actually
posted and links them; unposted reels keep a visible placeholder.
Auto-posting remains a separate, unmade decision.

## 2026-08-24 — Site publishing needs no token on this machine
Follow-up to the entry below: the first publish went through plain `git push`
using the box's cached Git Credential Manager credentials, so the pipeline's
primary path is now a local shallow clone + commit + push
(`publishViaGit` in github.ts); the Contents-API path with GITHUB_TOKEN is
the fallback for when the pipeline ever leaves this machine. Live since
f607def: smbsolved.com/templates/ (page, gated through the Kit landing page)
and /templates/smbsolved-fixed-asset-register.xlsx (+ verification JSON
published alongside, deliberately public).

## 2026-08-24 — Templates are hosted on smbsolved.com, published by commit
The download link in Kit emails points at
https://smbsolved.com/templates/smbsolved-fixed-asset-register.xlsx. The site
repo (github.com/jhtx/my-website, plain static HTML) is deployed by Netlify
on every commit, so `template-far.ts` publishes the verified xlsx through the
GitHub Contents API (`pipeline/github.ts`, fine-grained PAT scoped to that
one repo, Contents read/write). The URL is permanent; the file behind it
updates. No third-party file host, no expiring share links.

## 2026-08-24 — The close note is drafted for review (owner's call)
Supersedes "the close note is a placeholder": the owner wants it populated
and will review. `newsletter.ts` now drafts it with one small model call
(process-focused, grounded in close mechanics, forbidden from inventing
client stories as fact, house voice rules embedded) and marks it
[DRAFT FOR REVIEW]. It remains the section the owner rewrites in his own
words; `--no-note` restores the empty placeholder.

## 2026-08-24 — Newsletter drafts are assembled, not generated
`pipeline/newsletter.ts` (npm run newsletter; biweekly Monday task available)
drafts "The Tie-Out" from the two newest verified reels. Deterministic on
purpose: every sentence in the fix sections is lifted from reel JSON that
already passed the reviewer, so no model runs here and the letter cannot
drift from the reels. The close-process note is a bracketed placeholder —
that section is the owner's voice, by design, never generated. The draft
lands as a Kit DRAFT broadcast (send_at null) when the plan allows the API
call, and always as an HTML file plus a Slack notice. Owner's plan gates
observed so far: sequence and sequence-email creation 403 over the API
(added by hand); broadcasts checked at first run.

## 2026-08-24 — Kit: API creates what it can, the UI does the rest
Kit's v4 API creates tags, sequences and sequence emails, but not forms or
landing pages. `pipeline/kit-setup.ts` (npm run kit:setup) creates the
`template-far` tag, the "Welcome" sequence and its three emails (copy from
docs/newsletter-kit.md, placeholders left visible) the moment KIT_API_KEY
lands in `.env.local` (app.kit.com → Settings → Developer → V4 Keys; header
X-Kit-Api-Key). Idempotent by name. The form, landing page and the
form→tag→sequence automation stay UI steps; the script prints them. Note:
the Kit MCP server the owner added on claude.ai is not visible from Claude
Code sessions; the API key is also what the future newsletter generator
needs, so the key is the right wiring anyway.

## 2026-08-24 — The backlog is the queue; generals are interleaved
Queue order = file order. Owner promoted mined items 012–017 correctly; the
Ready section was reordered so a `[general]` lands roughly every third item
(one per week at 3–4 reels/week) instead of five in a row. Backlog header
now documents the queue semantics; mined entries keep their source line as
writer context.

## 2026-08-24 — Topic miner: Stack Exchange default, Reddit behind credentials, humans promote
`pipeline/mine.ts`, weekly (Sundays, `scripts/register-mine-task.ps1`).
Deterministic fetch + one model call (prompts/miner.md) → candidates appended
under "## Mined" in the backlog with source links, tagged
controller/owner/general. Mined entries have no **NNN** number, so the daily
run can never pick one — a human promotes by numbering it. Sources: Stack
Exchange API (open, no key; newest 40 per tag — a date window starves it,
Excel question volume is thin in 2026). Reddit (the richer accounting signal:
r/Accounting, r/Bookkeeping, r/QuickBooks) blocks unauthenticated JSON from
this network; it activates automatically when REDDIT_CLIENT_ID/SECRET land in
`.env.local` (free "script" app at reddit.com/prefs/apps). ~$0.15/run.

## 2026-08-24 — Templates are verified by two independent implementations
`pipeline/template-far.ts` + `pipeline/templates/build-fixed-asset-register.ps1`.
Real Excel (COM) builds the workbook and reports what it computed; TypeScript
re-derives every key number from the same conventions; any mismatch blocks
publishing. Conventions for the fixed-asset register: book = straight line,
full-month (in-service month counts, disposal month does not); tax = MACRS GDS
half-year with bonus in year one reducing basis; §179 not modeled (Readme says
ask your preparer); assets disposed in prior years are removed by the user.
No macros, Excel 2016+. Published to OneDrive → Marketing → Templates with a
verification JSON (Excel build, date, checks compared, file hash).

## 2026-08-23 — Reads like a person, enforced by the gate
Owner rule: scripts and captions must not read as AI-written. Em/en dashes are
now a hard verify error anywhere a viewer sees or hears text (hook, payoff,
vo, captions, post copy); semicolons in captions warn. The writer prompt bans
stiff verbs ("resolves", "coerces"), balanced antithesis, same-shaped caption
pairs, and demands contractions and uneven sentence lengths; the reviewer
checks the same list with "would a controller text this to a coworker" as the
bar. Reels 001 and 002 were hand-polished to the new voice.

## 2026-08-23 — #N/A is spoken "N A"; error values live in the lexicon
Owner's call: "N A", not "N slash A". All error values moved into
`src/reel/speech.ts` (#N/A → "N A", #VALUE! → "value error", #REF! → "ref
error", #NAME? → "name error", #DIV/0! → "divide by zero error", #SPILL! →
"spill error"). The writer now writes error values exactly as Excel shows
them, in vo and captions alike; hand-spelled pronunciation in a script is a
bug.

## 2026-08-23 — One general-audience tip reel per week
Owner's call: one of the 3–4 weekly reels is a plain Excel tip for anyone in
a spreadsheet, to widen the top of the funnel beyond accountants. Tagged
`[general]` in the backlog; hook may target any office worker; everyday but
real data allowed; same visual grammar, same Excel verification, still a
before/after formula (Flash Fill-style tips wait for the schema widening).
Five general topics seeded (007–011).

## 2026-08-23 — Pronunciation is code, not prompt discipline
ElevenLabs read "SUMIF" as "SOOMIF" in the first voiced reel. Fix:
`src/reel/speech.ts` — a lexicon that rewrites function names and accounting
shorthand for the voice model ("SUMIFS" → "sum ifs", "GL" → "G L",
"MACRS" → "makers"). Applied identically in `voice.ts` (the text sent) and
`timeline.ts` (the alignment slicing), so beats can never drift; captions keep
the real spellings. The writer now writes function names naturally and spells
only symbols/error values phonetically. Extending the lexicon is a normal code
change; re-voicing an old reel picks up the new pronunciation.

## 2026-08-23 — Fonts: Carlito / Archivo / IBM Plex Mono, bundled
Chosen and bundled in `public/fonts`, loaded via `@remotion/fonts` `loadFont()`
(blocks render readiness — no silent fallback). ReelSheet = Carlito
(SIL OFL, metric-compatible Calibri twin: the sheet reads as Excel without
licensing Aptos/Calibri). ReelDisplay = Archivo 500/800 (heavy grotesque
with a true 800 for captions/overlays). ReelMono = IBM Plex Mono 500
(eyebrow, pills). All OFL — video embedding is unambiguous.

## 2026-08-23 — Grammar refinements from QA-ing the first automated reel (002)
- "Red = wrong" is about the *state*, not the Excel type: a wrong number
  (`0.00` where March should total) renders red and bold at `showError`, the
  same as `#N/A`.
- The pencil circle sizes to the value (~17px per character, 200–292px) and
  follows its alignment, so a short right-aligned number is circled, not the
  empty left of the cell. The tie-out tick sits in column C beside the target
  cell, never on the value.
- Numbers in column B right-align, like Excel. Long formulas wrap to two lines
  in the formula bar at 22px instead of clipping; the name box and `fx` cell no
  longer shrink.
- The "changed characters" highlight during `typeFix` is Excel green (the fix
  state) and appears only when the change is a tweak (<60% of the formula);
  a rewrite is typed plain.

## 2026-08-23 — ElevenLabs `alignment` confirmed empirically
Five with-timestamps calls: `alignment.characters.length` = 197 = the input
text length; `normalized_alignment` = 199. The old code would have drifted by
two characters on reel 001 alone, more on any reel with numbers.

## 2026-08-22 — Length band is 30–55s, not "under 40"
Instagram's own 2026 data on business accounts puts 45–60s ahead of <30s on
reach, engagement and median views; Shorts completion favours 30–60s; no
platform has a cliff before 90s. The beat sequence dictates length; never pad,
never rush a formula to fit a number. `verify` warns outside 25–60s.

## 2026-08-24 — The gate rejects control characters (from the reel 005 park)
The writer needed a non-breaking space inside vendor names (the CHAR 160
lesson) and wrote `\by` — the JSON backspace escape plus a stray letter — on
all three attempts. Excel then truthfully returned #N/A for the "fixed"
formula, the writer conformed `expected` to the error (as instructed: never
argue with Excel), and the reviewer blocked the narration/result
contradiction. Right park, wrong layer: the failure was detectable at
structure time. verify.ts now errors on any codepoint below U+0020 (plus
U+007F) in sheet cells, formula text, and facing text (`\n` allowed where
line breaks are legal); the writer prompt (rule 12) says how to encode an
invisible space (`\u00a0`). NBSP itself stays allowed — it is the lesson.
Probed in real Excel before fixing: with a genuine NBSP this reel's fix
returns 4,812.00 and both fill-downs match.

## 2026-08-24 — Schema widening: a reel may mutate its sheet once (insert a column or a row)
The cue vocabulary could only tell one story: a formula is wrong from the
first frame. A whole family of real problems is the opposite — the formula
was right, then someone changed the sheet under it (backlog 003, 006, and the
XLOOKUP family generally). Widened, deliberately and once:

- New cues, in order: `showInitial` (the formula lands its CORRECT value,
  plain ink, no tick — it is not a "fix", it is just working), then
  `insertColumn` / `insertRow` (the newcomer opens and everything after it
  shifts), then the existing `showError` onward.
- `sheet.mutation = { kind, at }` names the newcomer. The reel JSON always
  describes the FINAL sheet; the composition renders the initial state by
  collapsing the newcomer to zero width/height. One definition, no duplicated
  data, and the pre-insert state cannot drift from the post-insert one.
- Column letters and row numbers are POSITIONAL, derived from index, never
  from the schema key. Inserting a column does not relabel the headers, it
  moves the data under them — which is exactly what a viewer sees in Excel,
  and why the target ref in the name box changes B8 → C8 on its own.
- Rows gained a third data column `c`. A reel with a mutation renders three
  data columns and moves the audit-mark column to D. Non-mutation reels are
  byte-identical to before.

The gate got the interesting half. `recalc.ps1` now performs the real
`Columns(x).Insert()` / `Rows(n).Insert()` in Excel between two calculation
passes, so three things are verified rather than two: the formula's result in
the original sheet (`expectedInitial`), its result after the insert
(`expected`), and the fix (`after.expected`). Excel — not the writer — decides
what the formula becomes when it is shifted, and `formulas.before.textAfter`
must equal that readback. That is the whole lesson of 006 made checkable: the
range grows, the column index does not.

Consequence for 003 (hardcoded SUM range): the insert beat now exists, but the
honest fix is a structured Table reference, which needs ListObject rendering in
the composition and in the gate. 003 stays parked on that narrower reason, not
on the missing insert.

## 2026-08-24 — Auto-posting, on the ✅ reaction (owner's decision, supersedes "no auto-posting in v1")
The 2026-08-22 entry said auto-posting was not worth the auth pain at three
reels a week. The owner's call today reverses it: the manual step is the
bottleneck now, and reels 002/004/005 sat built-and-unposted to prove it.

The approval gesture does not change, its meaning does. ✅ on the Slack message
used to record "I posted this"; it now means "post this for me". That is the
authorization for an outward-facing, effectively irreversible action, so it
stays a deliberate human gesture — nothing posts without it, and there is no
scheduled auto-approve.

Built in the order CLAUDE.md named: YouTube → Instagram → LinkedIn → TikTok.
Honest about what each API actually does:

- **YouTube Shorts** — real publish. Data API v3 `videos.insert`, resumable
  upload, one-time OAuth consent, refresh token in `.env.local`.
- **Instagram Reels** — real publish. Content Publishing API needs the video at
  a public HTTPS URL, so the MP4 is attached to a GitHub release on the public
  `jhtx/smbsolved-marketing` repo (assets live outside git history, so nothing
  bloats, and it doubles as an off-machine backup). Token needs the
  `instagram_business_content_publish` scope.
- **LinkedIn** — real publish, to the founder's personal profile
  (`w_member_social`), three-call video upload. 60-day token; the poller warns
  in Slack a week before it expires.
- **TikTok** — NOT a real publish, and labelled as such. Until the app passes
  audit, the Content Posting API can only drop an unaudited draft into the
  app's inbox, so the poller reports "draft pushed, finish in the app" and the
  Slack checklist keeps the manual line. Do not report it as posted.

Every platform is independent and idempotent: results are recorded per platform
in `NNN-slug.delivery.json`, a platform that already succeeded is never retried,
and one platform failing never blocks the others. Failures reply in the reel's
own Slack thread. Reels delivered before this shipped have no delivery record
and are therefore invisible to the poller — they cannot be double-posted.

## 2026-08-24 — Performance numbers are pulled nightly and fed to the miner
`pipeline/analytics.ts`, daily at 05:45 (`scripts/register-analytics-task.ps1`).
The point is not a dashboard, it is closing the loop: the Sunday miner picks
next week's topics, and it now sees which of this month's reels people actually
finished. `performanceReport()` renders the latest numbers per reel, best and
worst, with each reel's title so the model sees the topic rather than a
filename, and mine.ts drops the section entirely when there are fewer than four
data points. A blank "what worked" table would invite the model to invent a
pattern it cannot have seen.

Honest about coverage, because two of the four platforms give nothing:
Instagram has real per-media insights, YouTube has counts plus watch time when
the Analytics scope is authorised (and lags up to 48 hours), LinkedIn has no
analytics API for member posts (only organization pages, and these go out from
a personal profile), and TikTok is invisible because the drafts are published
by hand so the pipeline never learns the video id.

Storage is SQLite through `node:sqlite`, built into Node 24, so no dependency.
One row per reel per platform per day, primary key on all three, so a re-run
overwrites instead of double-counting. It lives in out/ and is copied to the
OneDrive archive on every run: out/ is disposable and the history is not, and
committing a binary that rewrites daily would bloat the repo the same way the
MP4s would have.

Only reels posted in the last five weeks are pulled. The tail is noise, and
bounding the window keeps the nightly call count flat as the channel grows.
