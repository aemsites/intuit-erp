---
name: brand-check-and-fix
description: Evaluate the current page against Intuit Enterprise Suite's brand guidelines via the governance-agent MCP server, fix any violations directly in the content, then re-check to confirm full compliance.
version: 1
status: approved
---

# Brand Check and Fix

Evaluate the current page against the site's brand guidelines, identify any violations, fix them directly in the content, then re-run the check to confirm full compliance. This is a general-purpose skill — call it from any page-creation or page-editing skill (e.g. `case-study-page-creation`), or run it standalone against any existing page.

## Steps

1. **Read the current page content** using `content_read` to retrieve the full HTML.

2. **Run a brand evaluation** using `mcp__governance-agent__evaluate_text` with the page's Live Preview URL. Use `details: true` to get per-check reasoning.

3. **Report the initial results** — list each check with pass/fail status and a plain-language summary of any violations found. Report every check individually — do not summarize as "all passed" without listing what was checked.

```
:::checklist
- [x] **Check title** — Reasoning from the governance tool.
- [ ] **Check title** — Reasoning from the governance tool. Offending text: "…". Fix: [what will be changed].
:::
```

4. **Fix all violations in a single `content_update` call** — do not make partial or multiple updates. The specific rules come from whatever the governance tool flags (this project's brand guidelines are configured in the governance-agent, not hardcoded here), but common categories to expect on a B2B SaaS product site like this one include:
   - Trademark/legal symbol usage (™, ®) and legal-entity-name rules on first mention vs. body copy
   - Full product name required on first mention (e.g. "Intuit Enterprise Suite" before shortening to "the Suite" or "IES")
   - Competitor comparisons — named-competitor benchmarks may need reframing rather than removal, depending on the guideline (this site's own `/compare` page does name competitors deliberately, so check whether the flagged instance is that kind of sanctioned comparison before changing it)
   - Tone — target confident, human, and approachable; flag anything jargon-heavy or overly aggressive
   - AI framing — this is an "AI-native ERP" site, so AI-related copy should frame AI as something that assists and automates for the team, not as an unaccountable replacement for human judgment
   
   Write a clear summary listing every change made — don't just say "fixed."

5. **Re-run `mcp__governance-agent__evaluate_text`** on the same Live Preview URL to confirm the fixes landed.

6. **Report the final results** — confirm all checks now pass, or flag any remaining issues that require manual review (e.g. legal sign-off, an image-level concern the tool can't fix by editing text).

## Notes

- Always use the **Live Preview URL** for governance evaluations — it reflects the current document state without needing an additional preview/publish step.
- Apply all fixes in a single update call — never make multiple partial edits.
- Never output raw HTML in the response — confirm changes in plain prose plus the checklist.
- If an issue can't be auto-fixed (legal review, image replacement, a judgment call the calling skill's author should make), flag it clearly with an `alert-warning` callout instead of guessing.
