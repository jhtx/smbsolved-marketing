# Newsletter: Kit setup + copy

**Live (2026-08-24):** landing page <https://smbsolved.kit.com/9df3dd7dc4> ·
form <https://smbsolved.kit.com/c9ff3e2aba> · tag `template-far` · sequence
"Welcome" (emails added by hand; this plan 403s sequence and sequence-email
creation over the API). Draft issues: `npm run newsletter` (biweekly schedule:
`scripts\register-newsletter-task.ps1`).

Decided 2026-08-23 (research in the strategy document): owned list on **Kit**
(free to 10,000 subscribers), mirrored to a **LinkedIn Newsletter** 24h after
each send. Biweekly. The pipeline drafts, Jimmy edits for ~15 minutes.

All outward-facing copy below follows the house rules: contractions, no em
dashes, no AI-sounding constructions.

---

## One-time setup (~30 min, needs Jimmy)

Most of this is now scripted. In order:

1. Create the free account at kit.com. Plan: "Newsletter" (free tier).
2. app.kit.com → Settings → Developer → **V4 Keys** → create one, and put it
   in `.env.local` as `KIT_API_KEY` (you cannot view it again later).
3. Run `npm run kit:setup`. It creates the `template-far` tag, the "Welcome"
   sequence and its three emails (copy below, placeholders left visible),
   and skips anything that already exists. Note: on some plans Kit refuses
   sequence creation over the API (403) even with a valid key — the script
   then asks you to create an empty sequence named `Welcome` in the UI
   (Send → Sequences → New sequence) and rerun; it picks it up and adds the
   emails. If email creation is refused too, the script writes all three to
   `out/kit-welcome-emails.html` for pasting. The API cannot create forms or
   landing pages on any plan, so:
4. Create a **form** named `verified-templates` (inline, minimal style).
5. Create a **landing page** named `Fixed asset roll-forward template` using
   the copy below. Note the URL; it goes in every bio and the LinkedIn
   Featured section.
6. Create the one free **visual automation**: trigger = joins form
   `verified-templates` → add tag `template-far` → start sequence "Welcome".
7. Open the Welcome sequence and replace [DOWNLOAD LINK], [CHANNEL LINK],
   [STEDA LINK], [BOOKING LINK]; confirm the delays (immediately / +3 days /
   +7 days) read the way you want them.
8. On LinkedIn: create a newsletter called **"The Tie-Out"** (working name,
   change freely). Cadence biweekly. First edition mirrors the first Kit
   issue.

---

## Landing page copy

**Headline:** A fixed asset roll-forward that actually ties

**Body:**

> Book and tax columns, disposals with gain or loss, and a tie-out row that
> tells you the moment something doesn't add up. Every formula was run and
> checked in real Excel before this file was published. No macros, nothing
> hidden, works in Excel 2016 and up.
>
> Drop in your email and it's yours. You'll also get The Tie-Out, a short
> letter every two weeks with one Excel fix and one close-process note. One
> click unsubscribes.

**Button:** Send me the template

---

## Welcome sequence

### Email 1 — immediately. Subject: `Your roll-forward template`

> Here's the template: [DOWNLOAD LINK]
>
> Three things worth knowing before you open it:
>
> 1. The yellow cells are inputs. Everything else calculates.
> 2. The tie-out row at the bottom should read OK all the way across. If it
>    shows a number instead, that number is exactly how far off you are.
> 3. Book depreciation is straight line with a full-month convention. Tax is
>    MACRS half-year. If your facts are different, the Readme tab says what
>    to change.
>
> Every formula in the file was run and verified in real Excel before it
> went out. If you find something that doesn't tie, reply and tell me. I'll
> fix it and credit you.
>
> Jimmy
> SMB Solved

### Email 2 — day 3. Subject: `The one that gets people during close`

> Quick one.
>
> The most common Excel problem I see in month-end close isn't a hard
> formula. It's a lookup that says #N/A while the value sits right there in
> the next column. Nine times out of ten the export stored your account
> codes as text, and Excel won't match text against a number.
>
> Fastest fix: multiply the lookup value by 1. That flips it to a number and
> the match comes back.
>
> I post a 40-second video like this a few times a week. They're all tested
> in Excel before they go up: [CHANNEL LINK]
>
> Jimmy

### Email 3 — day 10. Subject: `If the spreadsheet is the problem`

> Last one from me for a while, then it's just the letter every two weeks.
>
> If your fixed asset workbook has grown past what a workbook should carry,
> two things might help.
>
> If you have hundreds of assets, multiple entities, or book and tax bases
> that keep drifting apart, that's what we built Steda for. It's a fixed
> asset register that works with QuickBooks: [STEDA LINK]
>
> And if close itself is the problem, I do a free 30-minute look at your
> close process. No deck, no pitch, you'll leave with two or three concrete
> things to change: [BOOKING LINK]
>
> Either way, the letter keeps coming with one Excel fix and one close note
> every two weeks.
>
> Jimmy

---

## Biweekly issue template ("The Tie-Out")

Drafted by the pipeline from the fortnight's reels; Jimmy rewrites the
close-process note and hits send.

> **One fix.** [Best reel of the fortnight: the symptom in one line, the
> broken formula, the fixed formula, what Excel shows after. Link to the
> video.]
>
> **One close note.** [120 to 180 words. A real thing that went wrong in a
> close and what to change. Written by Jimmy, not generated.]
>
> **The template shelf.** [Link to the current verified template. One line on
> what changed if anything.]

Mirror to the LinkedIn newsletter 24 hours later, with the template link
pointing at the Kit landing page.

---

## Later wiring (when KIT_API_KEY exists)

- ManyChat keyword `TEMPLATE` on IG/TikTok → Kit form subscribe via the
  native integration.
- `pipeline/newsletter.ts` (not built yet): drafts the issue from the two
  latest reel JSONs and posts the draft to Slack for editing.
