# Backlog

Written by hand or promoted from mined candidates. The specific symptom is
what makes a reel land.

Format: `- [ ] **NNN** [tag] symptom → fix`. Tags: `[controller]`, `[owner]`,
`[general]` (untagged = accountant-facing). The daily run takes the FIRST
unchecked numbered item in file order, so this list is the queue. Keep one
`[general]` roughly every third or fourth item, so each week ships one.
Numbers are IDs: never reuse one, next free number wins.

Target three to four a week. Keep this list ten deep or the pipeline starves.

---

## Ready (queue order = file order)

- [x] **001** #N/A when the account code is visibly right there → lookup value
      is text, multiply by 1
- [x] **002** SUMIF over a date range returns 0 even though the dates look
      fine → dates imported as text, DATEVALUE
- [x] **004** Two account names look identical but won't match → trailing
      space from the export, TRIM
- [ ] **005** Vendor names match but the lookup still fails → non-breaking
      space (CHAR 160) from a web export, SUBSTITUTE
- [ ] **006** VLOOKUP breaks every time someone inserts a column →
      column index is positional, use XLOOKUP or MATCH
- [ ] **007** [general] The #N/A error wrecks your whole report → wrap the
      lookup in IFERROR with an empty string
- [ ] **012** [owner] Your VLOOKUP shows 0 where the source cell is actually empty, and the report reads like a real zero balance → Blank source cells return 0, so wrap it: =IF(VLOOKUP(...)="","",VLOOKUP(...)) or append &"" for text
      <https://superuser.com/questions/1934549/i-need-to-add-isblank-to-a-formula-but-not-sure-where-to-input-it-within-the-for> · A zero that means "no data" instead of "nothing owed" is the exact kind of lie an owner reads straight past. (high)
- [ ] **015** [controller] COUNTIF on a vendor name returns 0 because the memo line has extra text wrapped around the name → Wildcards do not work inside a cell reference; concatenate them: =COUNTIFS(Data,"*"&C4&"*")
      <https://stackoverflow.com/questions/79901159/how-to-use-countifs-to-count-referenced-cell-and-another-that-includes-a-value> · Bank feed and GL memo fields almost never hold the vendor name alone, so this fires constantly in real exports. (high)
- [ ] **008** [general] You typed the formula once and dragged it, and every
      row points at the wrong cells → lock the range with $ (F4)
- [ ] **016** [controller] LEFT on a date cell gives you 4531 instead of the month, even after you formatted the column as Text → Formatting does not change the stored serial number; use =TEXT(A2,"mm/dd/yyyy") before slicing it
      <https://stackoverflow.com/questions/79966942/why-doesnt-changing-a-cell-format-to-text-convert-existing-date-time-values-to> · It is the mirror image of the text-dates problem and explains the one thing everyone gets wrong about the Text format. (high)
- [ ] **017** [owner] Your tiered markup formula returns 0 for every amount over 500 → Excel will not chain 500<C2<1000; use AND(C2>=500,C2<1000) or order the IF thresholds high to low
      <https://stackoverflow.com/questions/79962195/how-can-we-fix-the-formula-we-have-a-problem-when-c2-is-more-than-500-the-ce> · Chained comparisons look like math class and silently evaluate to nonsense, which is a satisfying one-line reveal. (high)
- [ ] **009** [general] Counting how many times each name shows up, by hand →
      COUNTIF over the list
- [ ] **013** [general] Rows you have not filled in yet say 126 years old and 46,150 days outstanding → Blank cells count as 0, so date math runs off 1900; guard with =IF(C2="","",YEAR(TODAY())-YEAR(C2))
      <https://superuser.com/questions/1937456/excel-formula-showing-result-even-though-data-cells-are-blank> · The absurd number is instantly recognizable and the one-cell fix is a clean before/after. (high)
- [ ] **010** [general] Your percent change column blows up with #DIV/0! on
      new items → IFERROR around the division
- [ ] **014** [general] Your IF returns #N/A instead of the "not found" text you wrote in the false slot → MATCH throws an error rather than FALSE, so test it: =IF(ISNUMBER(MATCH(...)),"found","not found")
      <https://superuser.com/questions/1937618/excel-if-is-returning-a-n-a> · People assume IF catches a failed MATCH, and seeing why it cannot is a single clean concept. (high)
- [ ] **011** [general] Finding duplicates by eyeballing two columns →
      COUNTIF against the other column, anything over 0 is a dupe

*The tail is general-heavy; slot newly mined accountant topics between them
to keep the weekly mix at one general in three or four.*

## Candidates, not yet sharpened

- **003** Your total is off by exactly one row every month → SUM range
  hardcoded instead of a table reference. *Parked 2026-08-24: the payoff
  needs a row-insert animation the schema can't express yet. Promote when
  the beat vocabulary widens (see DECISIONS).*
- Depreciation schedule where the final year doesn't tie to cost
- Reconciliation where the difference is divisible by 9 (transposition)
- Pivot table showing counts instead of sums after a refresh
- Aging bucket formula that puts current invoices in 30+
- Accrual reversal that double-counts because of a stale date reference
- Filtered subtotal that includes hidden rows (SUM vs SUBTOTAL vs AGGREGATE)

## Rules

- If the symptom needs a setup sentence to make sense, it isn't sharp enough.
- One concept. If it needs two fixes, split it.
- Prefer problems caused by *data coming out of an accounting system*. That's
  the specific ground nobody else covers, and it's the reason someone follows
  this account rather than a generic Excel one.
- `[general]` reels: same grammar, same verification, hook for any office
  worker, everyday-but-real data allowed.
