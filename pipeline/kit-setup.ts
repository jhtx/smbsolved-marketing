/**
 * One-command Kit (ConvertKit) setup — everything the v4 API allows:
 *
 *   creates the `template-far` tag, the "Welcome" sequence, and its three
 *   emails (copy from docs/newsletter-kit.md, placeholders left visible).
 *
 * The v4 API cannot create FORMS or LANDING PAGES; those two stay in the UI
 * and this script prints the exact steps at the end.
 *
 * Needs KIT_API_KEY in .env.local: app.kit.com → Settings → Developer →
 * "V4 Keys" → create. Header is X-Kit-Api-Key. Idempotent: reruns skip
 * anything that already exists by name.
 *
 *   npx tsx pipeline/kit-setup.ts
 */
import './env';
import { kit } from './kit';

const p = (lines: string[]) => lines.map((l) => `<p>${l}</p>`).join('\n');

/** The three welcome emails. Placeholders in [BRACKETS] are filled in the Kit UI. */
const EMAILS: { subject: string; delay_value: number; delay_unit: 'days'; content: string }[] = [
  {
    subject: 'Your roll-forward template',
    delay_value: 0,
    delay_unit: 'days',
    content: p([
      `Here's the template: [DOWNLOAD LINK]`,
      `Three things worth knowing before you open it:`,
      `1. The yellow cells are inputs. Everything else calculates.`,
      `2. The tie-out row at the bottom should read OK all the way across. If it shows a number instead, that number is exactly how far off you are.`,
      `3. Book depreciation is straight line with a full-month convention. Tax is MACRS half-year. If your facts are different, the Readme tab says what to change.`,
      `Every formula in the file was run and verified in real Excel before it went out. If you find something that doesn't tie, reply and tell me. I'll fix it and credit you.`,
      `Jimmy<br>SMB Solved`,
    ]),
  },
  {
    subject: 'The one that gets people during close',
    delay_value: 3,
    delay_unit: 'days',
    content: p([
      `Quick one.`,
      `The most common Excel problem I see in month-end close isn't a hard formula. It's a lookup that says #N/A while the value sits right there in the next column. Nine times out of ten the export stored your account codes as text, and Excel won't match text against a number.`,
      `Fastest fix: multiply the lookup value by 1. That flips it to a number and the match comes back.`,
      `I post a 40-second video like this a few times a week. They're all tested in Excel before they go up: [CHANNEL LINK]`,
      `Jimmy`,
    ]),
  },
  {
    subject: 'If the spreadsheet is the problem',
    delay_value: 7,
    delay_unit: 'days',
    content: p([
      `Last one from me for a while, then it's just the letter every two weeks.`,
      `If your fixed asset workbook has grown past what a workbook should carry, two things might help.`,
      `If you have hundreds of assets, multiple entities, or book and tax bases that keep drifting apart, that's what we built Steda for. It's a fixed asset register that works with QuickBooks: [STEDA LINK]`,
      `And if close itself is the problem, I do a free 30-minute look at your close process. No deck, no pitch, you'll leave with two or three concrete things to change: [BOOKING LINK]`,
      `Either way, the letter keeps coming with one Excel fix and one close note every two weeks.`,
      `Jimmy`,
    ]),
  },
];

async function main() {
  // sanity: key works
  const acct = await kit<{ account?: { name?: string; primary_email_address?: string } }>('GET', '/account');
  console.log(`Kit account: ${acct.account?.name ?? acct.account?.primary_email_address ?? 'ok'}`);

  // 1. tag
  const tags = await kit<{ tags: { id: number; name: string }[] }>('GET', '/tags');
  let tag = tags.tags.find((t) => t.name === 'template-far');
  if (!tag) {
    tag = (await kit<{ tag: { id: number; name: string } }>('POST', '/tags', { name: 'template-far' })).tag;
    console.log(`created tag "template-far" (${tag.id})`);
  } else console.log(`tag "template-far" exists (${tag.id})`);

  // 2. sequence — POST /sequences is permission-gated on some plans (403 with
  // a valid key). Graceful path: ask for the empty sequence in the UI, rerun.
  const seqs = await kit<{ sequences: { id: number; name: string }[] }>('GET', '/sequences');
  let seq = seqs.sequences.find((s) => s.name === 'Welcome');
  if (!seq) {
    try {
      seq = (await kit<{ sequence: { id: number; name: string } }>('POST', '/sequences', { name: 'Welcome' })).sequence;
      console.log(`created sequence "Welcome" (${seq.id})`);
    } catch (e) {
      if (!(e as Error).message.includes('403')) throw e;
      console.log(`
Kit refused sequence creation over the API on this plan (403).
Two minutes in the UI instead:
  app.kit.com → Send → Sequences → "New sequence" → name it exactly: Welcome
Then rerun: npm run kit:setup  — it picks the sequence up and adds the emails.
If Sequences is not in your plan's UI at all, deliver the template through the
form's incentive email instead (Form → Settings → Incentive email) and skip
the sequence for now; the copy is in docs/newsletter-kit.md.
`);
      return;
    }
  } else console.log(`sequence "Welcome" exists (${seq.id})`);

  // 3. emails — same graceful handling.
  const existing = await kit<{ sequence_emails: { id: number; subject: string }[] }>(
    'GET',
    `/sequences/${seq.id}/emails`,
  );
  for (const e of EMAILS) {
    if (existing.sequence_emails.some((x) => x.subject === e.subject)) {
      console.log(`email "${e.subject}" exists, skipped`);
      continue;
    }
    try {
      await kit('POST', `/sequences/${seq.id}/emails`, {
        subject: e.subject,
        delay_value: e.delay_value,
        delay_unit: e.delay_unit,
        content: e.content,
        published: true,
      });
      console.log(`created email "${e.subject}" (+${e.delay_value} ${e.delay_unit})`);
    } catch (err) {
      if (!(err as Error).message.includes('403')) throw err;
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync('out', { recursive: true });
      const html = EMAILS.map(
        (m) => `<h2>${m.subject} (send: +${m.delay_value} ${m.delay_unit})</h2>\n${m.content}`,
      ).join('\n<hr>\n');
      writeFileSync('out/kit-welcome-emails.html', html);
      console.log(`
Kit refused sequence-email creation over the API on this plan (403).
The three emails are in out/kit-welcome-emails.html — open it in a browser and
paste each into the Welcome sequence in the UI (timings are in the headings).
`);
      break;
    }
  }

  console.log(`
Done via API. Two things the API cannot create — in app.kit.com:
  1. Grow → Landing Pages & Forms → Create → FORM, inline, name it
     "verified-templates". Copy is in docs/newsletter-kit.md.
  2. Same menu → Create → LANDING PAGE, "Fixed asset roll-forward template",
     paste the landing copy from docs/newsletter-kit.md.
  3. Automate → Visual Automations → new: joins form "verified-templates"
     → add tag "template-far" → start sequence "Welcome".
  4. Open the Welcome sequence and replace [DOWNLOAD LINK], [CHANNEL LINK],
     [STEDA LINK], [BOOKING LINK], then check the delays read
     immediately / 3 days / 7 days the way you want them.
`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
