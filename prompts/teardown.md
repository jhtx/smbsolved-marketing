# Teardown

Run **once**, on a strong model, against 15–20 Excel/accounting reels that
performed well. Output becomes the rubric that `script-writer.md` writes to and
that a cheap model can follow daily. Re-run every few months, not weekly.

This is not training. Nothing is being fine-tuned. You are extracting structure
so the cheap path has something to aim at.

---

## Input to assemble by hand

For each reference reel, record:

- transcript or on-screen text, typed out
- length in seconds
- view count, and roughly how it compares to that account's median
- seconds elapsed before the problem is stated
- seconds elapsed before the first visual change
- how many distinct concepts appear
- whether it opens on a symptom, a claim, or a promise

Put these in `reference/` as one markdown file per reel. Include the weak ones
too — a rubric built only on winners can't tell you what to avoid.

---

## The prompt

You are analysing short-form Excel and accounting tutorial videos to extract
repeatable structural patterns. You are not writing scripts and not judging
quality subjectively.

For the set below, produce:

1. **Timing distribution.** Where does the problem get stated? Where does the
   first visual change land? Where does the payoff land? Give ranges, and note
   whether the higher-performing ones cluster differently from the rest.
2. **Hook taxonomy.** Categorise the opening lines. For each category, how many
   reels used it and how they performed. Name the categories after what they
   actually do.
3. **Concept density.** Concepts per reel against performance. State whether
   the data supports "fewer is better" or does not.
4. **What the weak ones share.** Be specific and structural.
5. **A rubric**: 6–10 checkable rules a writer could follow, each traceable to
   something above. No rule that amounts to "be engaging".
6. **Three few-shot examples** from the set, chosen to span different hook
   categories, with a one-line note on what each demonstrates.

Where the sample is too small to support a claim, say so rather than
generalising. A rubric with four defensible rules beats ten invented ones.

---

## Then

Save the rubric to `prompts/rubric.md` and reference it from
`script-writer.md`. Save the few-shot examples to `prompts/examples/`.

**Copy structure, never scripts.** Recreating specific videos gets the content
deprioritised for being reused, and generic Excel-influencer output is the one
thing this channel has no advantage at. The advantage is that the person
running it has actually chased a broken lookup through a GL export during
close. That detail comes from the backlog, written by hand — not from here.
