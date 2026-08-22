# Click-tracking parity gaps (classified)

Remaining parity gaps of the Option B click-tracking runtime against a 15-page
prod golden captured from erp.intuit.com (as of 2026-08-21).

- **Closeable fidelity: 96.1%** (588 CTA+video events × 11 DOM-derivable fields).
- Oracle: `node scripts/diff/parity-gate.mjs` (deterministic, per-field/per-component).
- Fields are compared on `trim()` — leading/trailing whitespace and newline
  differences count as matches.
- Residue sheet is reverse-engineered from the golden by
  `scripts/diff/gen-sheet-from-golden.mjs` (the customer's authoring seed).
- Fields already at 100%: `event`, `object`, `object_detail`, `action`,
  `ui_object`, `ui_action`, `data-wa-link`, `icom_user_action`.
- Remaining fails: `ui_access_point` (trail) 156 cells, `link_name` +
  `ui_object_detail` 97 cells (all *benign superset* — see B).

Each gap is one of:
- **(A) Markup gap in our ported blocks** — our EDS block renders a different
  structure than prod; closing it needs a block/markup change. → **block owners.**
- **(B) Prod-side inconsistency** — prod's authored data is inconsistent or wrong;
  we emit a cleaner/superset value (never less). → **customer analytics.**
- **(C) Fixable on our end** — a tracking-layer gap our runtime could close;
  remaining ones are structurally entangled / low-yield.

---

## (A) Markup gaps in our ported blocks — block owners

| Component | Field | Cells | Detail |
|---|---|---|---|
| blog cards (`dynamic_category_container`, `related-blogs`) | whole beacon + `ui_access_point` | 135 structural + 7 trail | Prod fires **per-element** on each card's `img`/`picture`/container `div` (nested `qrc_content_card_grid\|qrc_content_card\|…`); our EDS cards are a **single anchor**, so we emit one beacon per card where prod emits several. Filed **#769**. |
| article hero (`case-study-header`) | eyebrow / byline links | (with #765) | Prod linkifies the category eyebrow ("Case study") + author byline; our EDS renders them as **plain text**, so there's no CTA to track. Filed **#765**. |
| `secondary-nav` | `ui_access_point` | 30 | Prod is a **link-based 3-level nav** (`secondary_nav > menu_item (category link) > menu_link`) plus a `site_search`. Ours is a **flyout with category *buttons*** (toggles, not links) and no in-nav search — structural mismatch. |
| `disclaimer` | `ui_access_point` | 17 | The tracked entry is largely the "Important pricing details" **toggle**, which we render as `<summary>` (not a CTA / `a`·`button`·`[role=button]`). Needs a markup change to become trackable. |
| `product_banner` | `ui_access_point` | 4 | No `product-banner` block exists in our port; not reproducible without adding the component. |

## (B) Prod-side inconsistencies — customer analytics

We never *lose* data here — we emit a cleaner or superset value. Replicating
prod's inconsistency byte-for-byte is possible but not recommended.

| Component | Field | Cells | Prod behavior → ours |
|---|---|---|---|
| content links (`page`, `button`, `cta`, `disclaimer`, `link`, `video_link`, `product_banner`) | `link_name` | ~55 | **Inconsistently omits** `link_name` on some content links that otherwise get the CMS's `<kind>-<slug>` value → we derive it consistently (superset). |
| ToC entries (`toc`), carousel dots (`testimonial`) | `ui_object_detail` | ~41 | Emits `""` → we emit the heading / dot number (superset). |
| `video` | `ui_access_point` | 33 | **Inconsistent trails** for the same play control across pages: `video`, `video\|video\|video`, and card-nested variants — no single value matches all. |
| `case-study-header` share row | `ui_access_point` | 17 | The golden **double-keys** the share links (both `social_media` and `qrc_article_hero\|social_media`) — a prod nesting inconsistency. |
| `testimonial` | `ui_access_point` | 12 | Trail is inconsistent across templates (product pages `rw_testimonial`, homepage `page`). |
| nav-flyout links (`link`), inline images (`image`) | `ui_access_point` | 7 | Prod emits **no** `ui_access_point`; we emit `page` (superset). |
| `footer` | `object_detail` / `ui_access_point` | 2 | "About Intuit" appears in both `footer_bottom` and `footer_menus` (duplicate link, two trails). |
| FAQ / cards | `wa-link`, `object_detail` | — | Hand-authored codes are inconsistent: FAQ pool assigned out of order + duplicated; a `rticles-…` typo; three distinct cards share one `wa-link`. Replicated byte-for-byte for parity; details in `scratchpad/prod-tracking-bugs.md`. |

## (C) Fixable on our end — remaining (entangled / low-yield)

| Component | Field | Cells | Why deferred |
|---|---|---|---|
| `faq` | `ui_access_point` | 13 | The question-toggle CTAs already resolve to `accordion`; these 13 are **answer-body content links** inside `.faq-answer`, which prod tracks as `page`. They sit structurally inside the accordion block, so re-scoping them to `page` without breaking the toggles that already match is risky for a 13-cell gain. |
| `cards` (grid variant), `button` | `ui_access_point` | 14 | Trail-variant reconciliation (grid vs carousel nesting; generic buttons) — verify per rendered variant. |

---

## Recommendation

1. **Ship** the current runtime + the generated residue sheet (customer authors the equivalent).
2. **Customer analytics** to review Category B — decide keep-for-continuity vs correct.
3. **Block owners** to pick up #765, #769, and (if strict parity is wanted) secondary-nav, disclaimer toggle, and product_banner.
4. Category C is structurally entangled and low-yield; pick it up only if strict 100% is required.
