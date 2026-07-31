---
name: transcript-update-brand-check
description: Extract the website-change discussion from an uploaded meeting transcript, turn it into a content update plan, apply it to the current page, then brand-check it via the brand-check-and-fix skill.
version: 1
status: approved
---

# Transcript Update + Brand Check

Update the currently open page based on a meeting transcript instead of hand-typed instructions: pull out only the parts of the conversation that were actually about website changes, confirm a plan from that, apply it, then validate the result against brand guidelines.

---

## Step 1 — Get the transcript

If the user has not provided a transcript (pasted text or an attached file), ask:

> "Please share the meeting transcript you'd like me to work from."

Do not proceed until it's received. A transcript is expected to cover more than just this site — don't ask the user to pre-trim it, that's Step 2's job.

---

## Step 2 — Extract the website-change discussion

Read the full transcript and pull out **only** the parts that discuss actual website content changes — new pages, copy edits, section additions/removals, CTA changes, structural changes, etc. Ignore scheduling chatter, administrative asides, and topics unrelated to this site's content.

For each relevant point found, note:
- A short quote or close paraphrase of what was said
- Who said it, if attributable from the transcript
- The concrete change it implies

Present this as a short list, e.g.:

```
:::checklist
- [x] **Speaker A** — "we should soften the migration page's hero, it reads too aggressive" → tone down hero copy on /migration
- [x] **Speaker B** — "let's add the Q3 stat once finance confirms it" → flagged as not-yet-actionable, no confirmed number given
:::
```

Then ask:

> "Is this everything relevant, or did I miss/misread something from the transcript?"

Wait for confirmation before moving on — this is the step most likely to need correction, since transcripts are noisy and attribution can be ambiguous.

---

## Step 3 — Read the current page

Use `content_read` to fetch the current page content (org, repo, and path are available from the current page context).

---

## Step 4 — Plan

Analyze the current page against the confirmed extraction from Step 2. Produce a clear, human-readable plan that describes:

- Which sections will be added, removed, or modified
- What copy changes will be made (headlines, body text, CTAs, etc.)
- Any structural changes (new blocks, removed blocks, reordered sections)
- Which extracted transcript point each change traces back to

Present the plan as a numbered or bulleted list and ask:

> "Does this plan look correct? Should I go ahead with these changes?"

Wait for explicit confirmation before proceeding. If the transcript only yielded one or two confirmed items, keep the plan just as small — don't pad it with unrelated cleanup.

---

## Step 5 — Make the changes

Once the user confirms the plan:

1. Apply ALL changes in a single `content_update` call — never make partial updates.
2. Follow EDS HTML content rules:
   - Start with `<body>`, end with `</body>`; wrap content in `<main>…</main>` with `<header></header>` before it and `<footer></footer>` after
   - Sections as top-level `<div>` tags inside `<main>`
   - Blocks as `<div class="block-name">` with row/column child `<div>` elements
   - No `<!DOCTYPE>`, `<html>`, `<head>`, inline styles, or literal `<table>` for blocks
3. Briefly confirm what was changed in plain prose, tying each change back to its transcript source.

---

## Step 6 — Brand check

Run the **brand-check-and-fix** skill (`experience-workspace/skills/brand-check-and-fix.md`) against the page just updated, using its Live Preview URL. That skill handles reading the content, evaluating it with `mcp__governance-agent__evaluate_text`, fixing any violations in one `content_update`, and re-confirming compliance — follow it as written and fold its checklist output into this run, rather than re-implementing evaluation/fix steps here.

---

## Step 7 — Next steps

Once the brand check has passed (or remaining issues have been flagged per that skill's own escalation rules), ask the user:

> "The page is updated and on brand. Would you like me to **publish the page** to make it live, or would you like to **invite a stakeholder** for collaboration and review?"

---

## Notes

- **Extraction is the part most likely to go wrong** — a transcript is noisy, multi-topic, and attribution can be ambiguous. Always get explicit confirmation on the extracted excerpts (Step 2) before planning, and again on the plan itself (Step 4), rather than compounding an extraction mistake into a content change.
- Don't invent action items from vague discussion — if something was floated but not decided (e.g. "let's add the Q3 stat once finance confirms it"), flag it as not-yet-actionable rather than including it in the plan.
- Apply all content changes in a single `content_update` call — never make multiple partial edits.
- Never output raw HTML in responses, and never ask the user to copy-paste HTML.
- Brand checking is delegated entirely to `brand-check-and-fix` — do not duplicate its evaluate/fix/re-check steps inline in this skill.
