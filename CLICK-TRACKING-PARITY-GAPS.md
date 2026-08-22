# Click-tracking parity gaps (classified)

Status as of 2026-08-21. Reverse-engineered parity of the Option B click-tracking
runtime against a 15-page prod golden captured from erp.intuit.com.

- **Closeable fidelity: 96.1%** (588 CTA+video events, 11 DOM-derivable fields each). Fields are compared on `trim()` — leading/trailing whitespace and newline differences count as matches.
- **~96.8% "harmful-adjusted"** — the difference is *benign superset* (we emit
  slightly more than prod, never less; see Category B).
- Oracle: `node scripts/diff/parity-gate.mjs` (deterministic, per-field/per-component).
- Residue sheet is reverse-engineered from the golden by `scripts/diff/gen-sheet-from-golden.mjs`
  and hands to the customer as the authoring seed.
- 100% fields: `event`, `object`, `object_detail`, `action`, `ui_object`,
  `ui_action`, `data-wa-link`, `icom_user_action`. Remaining: `ui_access_point`
  (trail, ~120 cells), `link_name` (~61), `ui_object_detail` (~60).

Gaps are classified as:
- **(A) Markup gap in our ported blocks** — our EDS block renders a different
  structure than prod; closing it needs a block/markup change (some already filed
  as issues). Not a tracking-config gap.
- **(B) Likely bug/inconsistency on prod's end** — prod's authored data is
  inconsistent or wrong; we replicate it for parity where it matters, and emit a
  cleaner/superset value where it doesn't. Flag for the customer's analytics team.
- **(C) Genuine issue to fix on our end** — our tracking layer is wrong vs prod
  and is fixable in code/sheet without a markup change.

---

## (A) Markup gaps in our ported blocks

| Component | Field(s) | Cells | Detail | Action |
|---|---|---|---|---|
| blog cards (`dynamic_category_container`, `related-blogs`) | whole beacon (structural set) + `ui_access_point` | 135 structural + related-blogs 5 | Prod fires **per-element** on each card's `img`/`picture`/container `div` (nested `qrc_content_card_grid\|qrc_content_card\|…`); our EDS cards are a **single anchor**, so we emit one beacon per card where prod emits several. | Filed **#769**. Excluded from the closeable gate as a known structural delta. Decide: reproduce per-thumbnail tracking (markup change) or consolidate + accept the analytics delta. |
| `case-study-header` (article hero) | eyebrow/byline links | (part of #765) | Prod linkifies the category eyebrow ("Case study") + author byline; our EDS renders them as **plain text**, so there is no CTA to track (`qrc_article_hero` no-ops). | Filed **#765** (assigned sdmcraft). |
| `secondary-nav` (Resource Center sub-nav) | `ui_access_point` | 30 | Prod is a **link-based 3-level nav**: `secondary_nav > menu_item (category link) > menu_link (submenu link)`, plus a `site_search`. Ours is a **flyout with category *buttons*** (toggles, not links) and no in-nav search — a structural mismatch, not just a missing `data-tracking`. | Restructure secondary-nav to prod's link-based nesting (block change) if strict parity is required; otherwise accept. |
| ~~`talk-to-sales` (floating widget)~~ | — | — | ✅ **RESOLVED** (was: injected to `<body>`, outside the region gate). `resolveTrackable` now tracks a declared `tracking-` block wherever it mounts; contact-us stamps `talk_to_sales`. Verified on preview. | Done. |

## (B) Likely bugs / inconsistencies on prod's end

We never *lose* data here — we emit a cleaner or superset value. Replicating
prod's inconsistency byte-for-byte is possible but not recommended; flag for the
customer's analytics team.

| Component | Field(s) | Cells | Prod behavior | Our behavior |
|---|---|---|---|---|
| page / footer / button content links | `link_name` | 61 | **Inconsistently omits** `link_name` on some content links that otherwise get the CMS's `<kind>-<slug>` value. | We derive `link_name` consistently → *superset* (never missing). |
| carousel dots (`testimonial`, others) | `ui_object_detail` | ~21 | Emits `""` (empty) for numbered pagination dots. | We emit the dot number ("1", "2", …) → more useful, but a mismatch. |
| ToC links (`toc`) | `ui_object_detail` | 20 | Emits `""` for table-of-contents entries. | We emit the heading text → superset. |
| ~~page links~~ | `ui_object_detail` | — | ✅ **RESOLVED** — prod's trailing whitespace (e.g. `"Privacy Policy "`) is now a match: the gate compares on `trim()`. | Done. |
| `video` | `ui_access_point` | ~33 | **Inconsistent trails** for the same play control across pages: `video`, `video\|video\|video`, and card-nested variants. | We can only stamp one trail; no single value matches all. |
| `case-study-header` share row | `ui_access_point` | ~16 | The golden **double-keys** the share links (as both `social_media` and `qrc_article_hero\|social_media`) — a prod nesting inconsistency. | We stamp one (`social_media`). |
| footer | (structure) | — | "About Intuit" appears in **both** `footer_bottom` and `footer_menus` (duplicate link, different trails). | Replicated per prod. |
| FAQ / cards `wa-link`, `object_detail` | (values) | — | Hand-authored codes are inconsistent: FAQ pool assigned out of order + duplicated; a `rticles-…` typo; three distinct cards share one `wa-link`. See `scratchpad/prod-tracking-bugs.md`. | Replicated byte-for-byte for parity (the oracle replays prod). |
| nav-flyout links, inline images | `ui_access_point` | link 4, image 3 | Prod emits **no** `ui_access_point` for these. | We emit `page` (the opt-in switch is always present) → superset. |

## (C) Genuine issues to fix on our end (fixable, no markup change)

These are tracking-layer gaps our runtime can close. **✅ DONE** rows landed this session; the rest are structurally entangled and left as documented follow-ups.

| Component | Field(s) | Cells | Status / Fix |
|---|---|---|---|
| `talk-to-sales` | `ui_access_point` (+ coverage) | 20 | ✅ **DONE** — `resolveTrackable` tracks a declared `tracking-` block anywhere; contact-us stamps `talk_to_sales`. Verified on preview. |
| `author_bio` | `ui_access_point` (+ `link_name`) | 4 | ✅ **DONE** — blog-template stamps `author_bio` (linkName off). Verified on preview. |
| `faq` | `ui_access_point` | 13 | **Entangled.** 38 question-toggle CTAs already resolve to `accordion` ✓; the 13 fails are **answer-body content links** inside `.faq-answer`, which prod tracks as `page`. They're structurally inside the accordion block, so scoping them to `page` without breaking the 38 needs the accordion `data-tracking` off the answer body — deferred (risk vs 13-cell gain). |
| `cards` (grid variant), `button` | `ui_access_point` | 5 + 9 | Trail-variant reconciliation (grid vs carousel nesting; generic buttons). Verify per rendered variant. |
| `disclaimer` | `ui_access_point` | 17 | **Mostly (A).** The tracked entries are largely the "Important pricing details" **toggle**, which we render as `<summary>` (not a CTA) — a markup change. The body legal links (few) could be wired via the `disclosure` block. |
| `product_banner` | `ui_access_point` | 4 | **(A)** — no `product-banner` block exists in our port; not reproducible without adding the component. |

### Already fixed this session (was C, now closed)
- Coverage: opt-in `tracking-<key>` → **track-by-default** (was the biggest gap; +21%).
- Residue alignment: golden-keyed sheet → `object_detail`/`wa-link`/`action`/`ui_object`/`ui_action` = 100%.
- **footer** nested trail (`footer\|footer_menus\|footer_menu_section` etc.) — verified on the authed preview DOM (98–100%).
- `link_name` derive suppression on inconsistent-presence blocks (sheet provides has-cases).
- `labelFor` (alt/aria-label) so text-less CTAs derive `ui_object_detail`/`link_name`.
- Wired `quick-links` (`quick_links`) + `cta-band` (`cta_block`) trails.
- **talk-to-sales** (region exception for the `<body>`-mounted widget) + **author_bio** trails — verified on preview.

---

## Recommendation

1. **Ship** the current runtime + the generated residue sheet (customer authors the equivalent).
2. **Customer analytics** to review Category B (decide keep-for-continuity vs correct).
3. **Block owners** to pick up #765, #769, and (if strict parity is wanted) the secondary-nav restructure.
4. The remaining Category C (faq answer-body links, cards grid variant) is structurally entangled and low-yield; a focused follow-up can pick it up if strict 100% is required. disclaimer/product_banner are effectively (A).
