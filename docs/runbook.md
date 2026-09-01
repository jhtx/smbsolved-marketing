# Runbook

What runs, when, and what Jimmy actually does. Current as of 2026-08-27.
Reasoning for every rule: `DECISIONS.md`.

## The machines

| Task Scheduler job | When | What |
|---|---|---|
| `smbsolved-reels` | Weekdays 06:30 | Next numbered backlog item → writer → real-Excel gate → reviewer → Jimmy's voice → render + LinkedIn stills → OneDrive archive + Slack post in #social-media |
| `smbsolved-reels-mine` | Sundays 17:00 | Stack Exchange + Reddit RSS → model distills candidates → appended under "## Mined" in the backlog + Slack notice |
| `smbsolved-reels-poll` | Every 10 min (register with `scripts\register-poll-task.ps1`) | Looks for a ✅ on a delivered reel and posts it to YouTube Shorts, Instagram Reels and the Facebook Page, then replies in the reel's Slack thread with the links. LinkedIn and TikTok are not in `AUTOPOST`, so it records them "post by hand" and never calls them |
| `smbsolved-reels-analytics` | Daily 05:45 (register with `scripts\register-analytics-task.ps1`) | Instagram insights + YouTube statistics for reels posted in the last five weeks into out/analytics.db, copied to the OneDrive archive. The Sunday miner reads it |
| `smbsolved-reels-newsletter` | Every other Monday 07:30 (register with `scripts\register-newsletter-task.ps1` if not yet) | Drafts The Tie-Out from the newest POSTED reels, Instagram permalinks filled, close note drafted for review → Kit draft broadcast + Slack |

All five need the PC on (sleep is fine) and Jimmy logged in (lock screen is
fine). A missed daily run pages via healthchecks → Slack.

### Logs, and the one rule about them

Everything lands in `out/logs`. Two scripts keep their own timestamped record
(`run.ts` → `run.log`, `poll.ts` → `poll.log`); every task additionally
captures its stdout to a file named for the task (`task.log`, `poll-task.log`,
`mine.log`, `analytics.log`, `newsletter.log`).

**A task's redirect target must never be the file its own script appends to.**
`cmd.exe` holds the redirect open for the whole run, so pointing both at one
name makes the script's own write fail with `EBUSY` on Windows. The poll task
did exactly that for two days and every firing died between reading the ✅ and
posting, with nothing in Slack to show for it. Reasoning in `DECISIONS.md`
2026-08-27.

When a scheduled job seems to do nothing, check
`Get-ScheduledTaskInfo -TaskName <name>` first. `LastTaskResult` of 0 is a
clean run; `3221226505` (0xC0000409) is the process aborting, and the reason
will be in the task's stdout log rather than the script's own.

## Jimmy's loop

- **Daily (~1 min):** watch the reel in Slack. If it is good, react ✅ and
  the poller posts it to YouTube, Instagram and the Facebook Page within ten
  minutes and replies in the thread with the links. LinkedIn and TikTok stay
  yours to post by hand
  (owner's call, `AUTOPOST` in .env.local); the copy is in the Slack message.
- **Weekly (~5 min):** curate Sunday's mined candidates — number the keepers
  (`- [ ] **NNN** [tag] ...`, next free number, file order = queue, one
  `[general]` per three or so), delete the rest.
- **Biweekly (~15 min):** open the Tie-Out draft in Kit → Broadcasts →
  Drafts, rewrite the close note in your own words, check the links, send.
  Mirror to the LinkedIn newsletter ~24h later.
- **10–15 min/day:** comment on target controller/CFO profiles on LinkedIn
  (evidence says this outranks a fourth post).

## Commands

```bash
npm run run -- --next            # one full daily run, by hand
npm run mine                     # mine topics now
npm run newsletter               # draft an issue now
npm run template:far             # rebuild + verify + publish the FA template
npm run template:far -- --check <path>   # re-verify a hand-edited copy, then publish
npm run ig                       # Instagram: who am I + latest media
npm run poll                     # check for ✅ and post now, instead of waiting
npm run poll -- --dry-run        # say what would happen, change nothing
npm run poll -- --retry          # after fixing a credential, re-run what did not go out
npm run doctor                   # probe every posting credential for real
npm run analytics                # pull the numbers now
npm run analytics -- --report    # exactly what the miner will be told
npm run authorize -- youtube     # one-time consent (also facebook, linkedin, tiktok)
npm run authorize -- facebook --from-user-token   # trade a user token for the Page token
npm run kit:setup                # idempotent Kit objects (tag/sequence/emails)
npm run site:publish -- <local> <repoPath>  # push any file to smbsolved.com
```

## The surfaces

- Reels archive: OneDrive → Marketing → Reels (one folder per reel)
- Templates: https://smbsolved.com/templates/ (page) — files publish by git
  push to `jhtx/my-website` using this machine's cached credentials
- Kit: landing https://smbsolved.kit.com/9df3dd7dc4 · form
  https://smbsolved.kit.com/c9ff3e2aba · tag `template-far` · sequence
  "Welcome" · drafts in Send → Broadcasts
- Instagram: @smbsolved (Business); token auto-refreshes on newsletter runs
- Slack: #social-media — reels, mining notices, newsletter notices, failures

## Editing a published template

Edit the copy in `out/templates/` (or anywhere), then:
`npm run template:far -- --check <path>`. It opens YOUR file in Excel,
recomputes, compares every key cell to the independent TypeScript values,
and only on a full pass writes a fresh verification record and publishes to
OneDrive + smbsolved.com. A file that fails does not ship, and the message
says exactly which cells disagree.

## Known constraints

- Excel COM needs an interactive session: the box must be logged in.
- Reddit is reachable only via its RSS feeds (rate limited; the miner spaces
  requests and skips 429s).
- Kit's API on this plan cannot create sequences/sequence emails (UI did it);
  broadcasts work.
- TikTok cannot publish through its API until the app passes content-posting
  audit, so the poller pushes a draft and says so. It never reports "posted".
  Owner's call 2026-08-25: post TikTok by hand until then.
- A Google account can manage several YouTube channels. Whichever one the
  consent screen picked is where Shorts land, so YOUTUBE_CHANNEL_ID pins it
  and the upload refuses to run against any other. `npm run doctor` names the
  channel a token actually controls.
- LinkedIn's credential is a 60-day access token, not a refresh token. The
  poller warns in Slack a week out; `npm run authorize -- linkedin` renews it.
- Facebook posts Reels to the SMB Solved Page with its own Page token. A USER
  token has the same permissions and cannot post; `npm run doctor` tells them
  apart, and `npm run authorize -- facebook --from-user-token` trades one for
  the other. On Facebook's consent screen the Page must be ticked explicitly.
- `AUTOPOST=youtube,instagram,facebook` holds LinkedIn and TikTok back from
  automatic posting even though LinkedIn's credentials work. Add a platform to that list
  to hand it over; `npm run doctor` shows which are held.
- Analytics cover Instagram and YouTube only. LinkedIn has no analytics API
  for personal-profile posts, and TikTok videos are published by hand so the
  pipeline never learns their ids.
- Reels 001, 002, 004 and 005 were delivered before the poller existed and
  have no delivery record, so it will never touch them. Post those by hand.
- Reel 003 (hardcoded SUM range → Table) is still parked, but on a narrower
  reason since 2026-08-24: the insert beat exists now, and what it still needs
  is a structured Table reference, which nothing renders or verifies yet.

## Next build items (in rough order)

Shipped 2026-08-24/25: schema widening for insert beats (reel 006 uses them),
the ✅ poller and auto-posting across five platform integrations, nightly
analytics feeding the miner, and `npm run doctor`.

Shipped 2026-08-27: the poller actually runs on its schedule (it had been
crashing on every firing since it was registered — `DECISIONS.md` 2026-08-27),
and reel 006 became the first to publish itself end to end, to YouTube,
Instagram and the Facebook Page.

Next, in rough order:

1. Facebook Page insights in `analytics.ts`. Facebook posts automatically now
   and its numbers are not collected, so the miner sees an incomplete picture
   of what actually landed.
2. Table / structured-reference rendering and verification, which is the only
   thing still parking reel 003.
3. Hand LinkedIn to `AUTOPOST` once the profile is warm. The cadence guard
   (`linkedinHold`) is already written and waiting behind the switch.
4. TikTok content-posting audit, if publishing there is worth the paperwork.
5. LinkedIn static-frame second composition variants, if the A/B warrants it.
