# Click-tracking coverage matrix

Readable view of the 21-page prod golden and how our Option B runtime covers it.
Source golden: `clicktrack-golden-customer.json`. Regenerate: `node scripts/diff/coverage-matrix.mjs`. Counts only — no campaign codes.

- **153 closeable events** (CTAs + video) + **8 structural** (non-CTA blog-card elements) = 161 across 21 pages.
- Cells compare our emitted value to prod on `trim()`. Legend: **✓** all match · **N✗** N events differ (gap) · **·** prod does not populate this field for this component.
- `Class`: residual-gap owner — **A** our markup, **B** prod inconsistency (we emit a clean/superset value), **C** fixable on our end, **—** none.

## Coverage summary

| Component | Events | Pages | Fidelity | Class | Dominant trail (ui_access_point) | Residual gap |
|---|--:|--:|--:|:--:|---|---|
| `faq` | 58 | 13 | 100% | C | `accordion` | answer-body links inside .faq-answer resolve to page on prod |
| `` | 22 | 9 | 95% | — | `page` |  |
| `nav` | 12 | 4 | 100% | — | `(none)` |  |
| `footer` | 12 | 2 | 100% | — | `footer|footer_bottom` |  |
| `cards` | 12 | 4 | 94% | C | `rw_cards_container|carousel|rw_card_1` | grid vs carousel trail variant |
| `case-study-header` | 11 | 3 | 97% | B | `qrc_article_hero` | golden double-keys the share-row trail |
| `talk-to-sales` | 6 | 2 | 100% | — | `talk_to_sales` |  |
| `hero` | 5 | 4 | 100% | — | `rw2_hero` |  |
| `cta` | 5 | 4 | 100% | B | `cta_block` | link_name over-production |
| `testimonial` | 3 | 2 | 94% | B | `(none)` | ui_object_detail dots emit ""; trail varies by template |
| `video` | 2 | 2 | 95% | B | `video` | inconsistent prod trails for the same play control |
| `feature` | 2 | 2 | 86% | B | `feature` | video trail |
| `product_banner` | 2 | 1 | 91% | A | `rw_banner` | no product-banner block in our port |
| `disclaimer` | 1 | 1 | 100% | A+B | `page` | tracked entry is the <summary> toggle (A); link_name over-production (B) |

## Field matrix

Each cell: **✓** match · **N✗** N events differ · **·** field not populated by prod here.

| Component | event | object | obj_det | action | ui_obj | ui_od | ui_act | ui_ap | wa | icom | link_nm |
|---|--|--|--|--|--|--|--|--|--|--|--|
| `faq` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 3✗ | ✓ | ✓ | 9✗ |
| `nav` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · |
| `footer` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `cards` | ✓ | ✓ | ✓ | ✓ | ✓ | 1✗ | ✓ | 7✗ | ✓ | ✓ | ✓ |
| `case-study-header` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 4✗ | · | · | ✓ |
| `talk-to-sales` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hero` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `cta` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `testimonial` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2✗ | ✓ | ✓ | ✓ |
| `video` | ✓ | ✓ | ✓ | ✓ | ✓ | 1✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `feature` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2✗ | ✓ | ✓ | 1✗ |
| `product_banner` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 2✗ | ✓ | ✓ | ✓ |
| `disclaimer` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ |

## Structural (non-CTA) — prod tracks per-element, our cards are single-anchor (#769)

| Component | Elements | Note |
|---|--:|---|
| `chat` | 8 |  |
