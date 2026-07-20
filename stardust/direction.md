---
_provenance:
  writtenBy: stardust:replica
  writtenAt: 2026-07-20T17:45:00Z
  againstInput: https://erp.intuit.com/
  readArtifacts:
    - stardust/current/pages/index.json
    - stardust/current/pages/pricing.json
    - stardust/current/pages/accounting.json
    - stardust/current/pages/compare.json
    - stardust/current/pages/erp-solutions.json
    - stardust/current/tokens/*.json
---

# Direction — preserve mode (same-design migration)

Mode: PRESERVE. The target spec is the captured current state of
https://erp.intuit.com/, kept as close to pixel-perfect as possible (no
`stardust:direct` invocation, no creative decisions).

Synthesized (bounded-single): current/pages/<slug>.json + Phase-3 CSS lift
→ PRODUCT.md · DESIGN.md · DESIGN.json (at 2026-07-20). Bounded `--pages`
entry: extract wrote page JSON + screenshots but no descriptive synthesis,
so the target spec was synthesized from captured content + lifted CSS
tokens per replica preserve-direction § 1a.

Key pages (one archetype each):
- `index` — home / landing
- `pricing` — pricing + lead form
- `accounting` — product/feature page (tabs, media-text, stat band, form)
- `compare` — competitor comparison table
- `erp-solutions` — solutions overview (two-path cards, FAQ)

Permitted deltas: ONLY the entries of
stardust/replica/inconsistency-register.md (0 entries — pure replica).

Fidelity: ia verbatim · design verbatim · content verbatim.

Font note: "AvenirNext forINTUIT" is a domain-licensed commercial kit — NOT
rehosted. Prototypes keep the brand family first in the stack and fall back
to Mulish (metric-matched). This is a justified, permanent gate residual on
the width probe, not an inconsistency-register item.
