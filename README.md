# smbsolved reels

Animated Excel tutorial reels for accountants. 1080x1920, 30–55s, rendered from
JSON. Posted to Instagram, TikTok, YouTube Shorts and LinkedIn.

Read `CLAUDE.md` before changing anything. The rules there exist so reel 40
looks like reel 1. The strategy document (2026-08-22) explains why.

## Setup

```bash
npm install
cp .env.example .env        # add your ElevenLabs key and voice id
npm run dev                 # Remotion studio, live preview
```

Requirements: Windows with Microsoft Excel installed (the verification gate
drives Excel through COM), Node 20+.

### Fonts — bundled, nothing to do

`public/fonts` ships Carlito (the sheet — metric-compatible Calibri twin),
Archivo 500/800 (captions and overlays) and IBM Plex Mono 500 (eyebrow,
pills), all SIL OFL. `src/reel/fonts.ts` loads them with `@remotion/fonts`
`loadFont()`, which blocks the render until each face is ready — headless
Chrome can never fall back silently. Changing a face is a `DECISIONS.md`
entry, not a swap.

## Making a reel

The whole thing, from the next backlog item to a Slack message with the MP4:

```bash
npm run run -- --next          # writer → Excel gate → reviewer → voice → render → deliver
npm run run -- --id 003        # a specific backlog item
npm run run -- --reel content/reels/002-sumif-text-dates.json   # skip the writer
```

Step by step, when you want to look at one stage:

```bash
npm run script -- --next --review     # writer + gate + reviewer; writes content/reels/NNN-slug.json
npm run review <reel>                 # reviewer only; writes NNN-slug.review.json
npm run build <reel>                  # gate → voice → render to out/NNN-slug.mp4
npm run build <reel> -- --no-voice    # reuse existing audio, iterate on visuals
npm run deliver <reel>                # archive to OneDrive + post to Slack
npm run verify <reel>                 # the gate only: structure + real Excel
npm run verify <reel> -- --structure-only   # fast iteration; still reports "not verified"
npm run excel <reel>                  # raw Excel results, for debugging a formula
npm run render <reel>                 # render with whatever audio/timing exists
```

Schedule it (weekday mornings, runs only while you are logged on — Excel COM
needs an interactive session):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
```

Set `HEALTHCHECK_URL` in `.env.local` (healthchecks.io, free) so a missed run
pages you; `run.ts` pings it after every run and `/fail` on failure.

Around the daily loop:

Once it is built and in Slack, a ✅ on that message posts it:

```bash
npm run poll                   # check for approvals and post now
npm run poll -- --dry-run      # say what would happen, change nothing
npm run authorize -- youtube   # one-time browser consent (also linkedin, tiktok)
powershell -ExecutionPolicy Bypass -File scripts\register-poll-task.ps1   # every 10 min
```

Every platform is optional. Without its credentials the poller records
"skipped, post by hand" and the Slack message says which variable is missing,
so a half-configured setup is obvious rather than silent. TikTok's API cannot
publish until the app is audited, so it pushes a draft to the app inbox and
reports `drafted`, never `posted`. LinkedIn is held to two posts a week
automatically.

```bash
npm run mine                   # weekly: pull Excel-problem threads, append tagged
                               # candidates under "## Mined" in the backlog.
                               # Promote one by giving it a **NNN** number.
npm run template:far           # build + verify the fixed-asset register template
                               # (real Excel vs independent TypeScript math)
powershell -ExecutionPolicy Bypass -File scripts\register-mine-task.ps1   # Sundays 17:00
```

## Why it refuses to render

Almost always: Excel displays something other than `expected`. The message
tells you both values. Open the reel JSON, fix `expected` (or the formula, or
the data) until what the viewer will see is what Excel computes. That is
intentional. The audience are accountants; a wrong formula costs more
credibility than fifty correct reels earn.

Second most common: Excel rewrote the formula (auto-closed a parenthesis,
inserted `@`). Fix the text so the viewer can retype exactly what they see.

The rest are structural: a formula referencing a row that isn't rendered, cues
out of order, a caption over two lines or 28 characters. `verify.ts` names the
specific problem.

If Excel itself cannot start (no Excel, or the script is running from a
service/Session 0), the gate fails closed. Run it from a logged-on session.

## Weekly loop

Roughly 30 minutes once the writer/reviewer agents are in place; today it is
the manual version:

1. Add two or three sharp symptoms to `content/backlog.md`. The specific
   symptom is what makes a reel land, and it comes from having hit the
   problem.
2. Generate and build the reels.
3. Watch each MP4 once with the safe-area guide on.
4. Post.

## Not built, deliberately

Auto-posting, a web UI, a second content format. Each is logged in
`DECISIONS.md` with the reason. Add one only by adding an entry there first.
