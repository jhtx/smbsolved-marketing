# smbsolved reels

Animated Excel tutorial reels for accountants. 1080x1920, 30–55s, rendered from
JSON. Verified in real Excel before anything renders, and published to YouTube
Shorts, Instagram Reels and the SMB Solved Facebook Page on a Slack reaction.
TikTok and LinkedIn are posted by hand, on purpose.

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

## Posting

Every reel lands in Slack with its copy and waits. A ✅ on that message means
"post this for me": `poll.ts` sees the reaction within ten minutes, posts, and
replies in the thread with the links.

Currently automatic: **YouTube Shorts, Instagram Reels, Facebook Reels** on the
SMB Solved Page. Held back by hand on purpose: **LinkedIn**, which is a
personal profile still being warmed up, and **TikTok**, whose API cannot
publish publicly until the app passes content-posting audit. `AUTOPOST` in
`.env.local` is the allow-list, and it is an allow-list rather than a
block-list so that adding credentials for a platform can never, on its own,
start publishing there.

```bash
npm run doctor                 # probe every credential for real
npm run poll                   # check for approvals and post now
npm run poll -- --dry-run      # say what would happen, change nothing
npm run poll -- --retry        # after fixing a credential, re-run what did not go out
npm run authorize -- facebook  # one-time consent (also youtube, linkedin, tiktok)
powershell -ExecutionPolicy Bypass -File scripts\register-poll-task.ps1   # every 10 min
```

`npm run doctor` exists because presence in `.env.local` proves nothing. It has
already caught a GitHub token that could read the repo but not create the
release Instagram needs, a YouTube token bound to the wrong channel, a Facebook
user token wearing a Page token's name, and a Facebook Page token that would
have expired an hour later. GitHub is verified by actually writing a release
asset and fetching it back with no credentials, the way Instagram will.

A platform with no credentials is recorded "skipped, post by hand" naming the
missing variable, so a half-configured setup is obvious rather than silent.

### When you react ✅ and nothing happens

`npm run poll -- --dry-run` first: it reads the live reaction and prints what
it would post, so it separates "the approval isn't being seen" from "the
posting is failing".

If that looks right and the scheduled job still posts nothing, the job itself
is dying rather than the code. Check
`Get-ScheduledTaskInfo -TaskName smbsolved-reels-poll` — `LastTaskResult` 0 is
a clean run, and `3221226505` is the process aborting. Then read
`out/logs/poll-task.log` (the task's stdout) rather than `out/logs/poll.log`
(the script's own record), because a job that dies early never reaches the
second one. That exact failure cost two days in August 2026; `DECISIONS.md`
2026-08-27 has the reason and the rule that prevents it.

Around the daily loop:

```bash
npm run analytics              # nightly: Instagram + YouTube numbers into
                               # out/analytics.db, archived to OneDrive, read
                               # by the miner. Facebook, LinkedIn and TikTok
                               # are not collected (see the runbook).
npm run mine                   # weekly: pull Excel-problem threads, append tagged
                               # candidates under "## Mined" in the backlog.
                               # Promote one by giving it a **NNN** number.
npm run template:far           # build + verify the fixed-asset register template
                               # (real Excel vs independent TypeScript math)
powershell -ExecutionPolicy Bypass -File scripts\register-mine-task.ps1        # Sundays 17:00
powershell -ExecutionPolicy Bypass -File scripts\register-analytics-task.ps1   # daily 05:45
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

## The loop, now that it runs itself

Weekday mornings the scheduled run writes, verifies, reviews, voices, renders
and delivers a reel on its own. What is left for a human:

1. **Daily, about a minute.** Watch the reel in Slack. React ✅ and it posts
   itself to YouTube, Instagram and Facebook, then replies in the thread with
   the links. Post the LinkedIn and TikTok copies by hand when you want them.
2. **Weekly, about five minutes.** Curate Sunday's mined candidates. Number
   the ones you would watch; delete the rest. Keep the queue ten deep or the
   pipeline starves, and keep roughly one `[general]` in three or four.
3. **Biweekly, about fifteen minutes.** Rewrite the close note on the Tie-Out
   draft in Kit, in your own words, and send it.

`docs/runbook.md` is the operational page: what runs when, every command, and
the constraints worth knowing before something breaks.

## Not built, deliberately

A web UI, and a second content format. Each is logged in `DECISIONS.md` with
the reason. Add one only by adding an entry there first.

Known gaps, written down rather than forgotten:

- Analytics cover Instagram and YouTube. Facebook Page insights exist and are
  not wired up yet, so the miner sees an incomplete picture of what landed.
- LinkedIn has no analytics API for personal-profile posts, and TikTok reels
  are published by hand so the pipeline never learns their ids. Both are
  permanently blind, not pending.
- Reel 003 needs a structured Table reference, which nothing renders or
  verifies yet. The insert beat it was originally parked on now exists.
