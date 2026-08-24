# Runbook

What runs, when, and what Jimmy actually does. Current as of 2026-08-24.
Strategy and evidence: `docs/strategy-2026-08-22.html` (also published as the
playbook artifact). Reasoning for every rule: `DECISIONS.md`.

## The machines

| Task Scheduler job | When | What |
|---|---|---|
| `smbsolved-reels` | Weekdays 06:30 | Next numbered backlog item → writer → real-Excel gate → reviewer → Jimmy's voice → render + LinkedIn stills → OneDrive archive + Slack post in #social-media |
| `smbsolved-reels-mine` | Sundays 17:00 | Stack Exchange + Reddit RSS → model distills candidates → appended under "## Mined" in the backlog + Slack notice |
| `smbsolved-reels-newsletter` | Every other Monday 07:30 (register with `scripts\register-newsletter-task.ps1` if not yet) | Drafts The Tie-Out from the newest POSTED reels, Instagram permalinks filled, close note drafted for review → Kit draft broadcast + Slack |

All three need the PC on (sleep is fine) and Jimmy logged in (lock screen is
fine). A missed daily run pages via healthchecks → Slack.

## Jimmy's loop

- **Daily (~3 min):** watch the reel in Slack, post it to IG/TikTok/Shorts
  (and LinkedIn per cadence), react ✅. Description text is in the Slack
  message.
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
- Instagram auto-posting is deliberately NOT built (decision open).
- Reel 003 (hardcoded SUM range → Table) is parked until the schema learns
  row/column-insert beats — the next engineering item.

## Next build items (in rough order)

1. Schema widening: row/column-insert beats (unparks 003, unlocks the
   XLOOKUP-vs-inserted-column family properly)
2. ✅-reaction poller: mark reels posted automatically, close the loop
3. Nightly analytics pull (IG insights + YouTube) into SQLite → miner input
4. LinkedIn static-frame second composition variants, if the A/B warrants it
