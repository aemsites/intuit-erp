# Click-tracking coverage matrix

Readable view of the 15-page prod golden and how our Option B runtime covers it.
Regenerate: `node scripts/diff/coverage-matrix.mjs`. Counts only — no campaign codes.

- **588 closeable events** (CTAs + video) + **136 structural** (non-CTA blog-card elements) = 724 across 15 pages.
- Cells compare our emitted value to prod on `trim()`. Legend: **✓** all match · **N✗** N events differ (gap) · **·** prod does not populate this field for this component.
- `Class`: residual-gap owner — **A** our markup, **B** prod inconsistency (we emit a clean/superset value), **C** fixable on our end, **—** none.

## Coverage summary

| Component | Events | Pages | Fidelity | Class | Dominant trail (ui_access_point) | Residual gap |
|---|--:|--:|--:|:--:|---|---|
| `page` | 148 | 14 | 98% | B | `page` | link_name inconsistently omitted by prod (we emit it — superset) |
| `footer` | 85 | 1 | 100% | — | `footer|footer_menus|footer_menu_section` |  |
| `faq` | 51 | 7 | 98% | C | `accordion` | answer-body links inside .faq-answer resolve to page on prod |
| `testimonial` | 45 | 5 | 93% | B | `rw_testimonial` | ui_object_detail dots emit ""; trail varies by template |
| `video` | 33 | 8 | 91% | B | `video` | inconsistent prod trails for the same play control |
| `secondary-nav` | 31 | 1 | 91% | A | `secondary_nav|menu_item` | flyout buttons vs prod link-based 3-level nav |
| `case-study-header` | 25 | 4 | 94% | B | `qrc_article_hero|social_media` | golden double-keys the share-row trail |
| `talk-to-sales` | 20 | 1 | 100% | — | `talk_to_sales` |  |
| `toc` | 20 | 4 | 91% | B | `TableOfContents` | prod ui_object_detail=""; we emit the heading (superset) |
| `button` | 19 | 13 | 91% | B+C | `page` | link_name over-production (B); generic-button trail (C) |
| `disclaimer` | 17 | 13 | 88% | A+B | `disclaimer` | tracked entry is the <summary> toggle (A); link_name over-production (B) |
| `social` | 16 | 4 | 100% | — | `social_media` |  |
| `cards` | 15 | 5 | 97% | C | `rw_cards_container|carousel|rw_card_1` | grid vs carousel trail variant |
| `nav` | 12 | 1 | 100% | — | `(none)` |  |
| `cta` | 8 | 5 | 98% | B | `cta_block` | link_name over-production |
| `hero` | 8 | 4 | 100% | — | `rw2_hero` |  |
| `image` | 6 | 4 | 95% | B | `(none)` | prod emits no ui_access_point (we emit page — superset) |
| `quick_links` | 6 | 1 | 100% | — | `quick_links` |  |
| `related-blogs` | 5 | 3 | 91% | A | `qrc_content_card_grid|qrc_content_card|video` | per-card nested video; single-anchor cards (#769) |
| `link` | 4 | 3 | 84% | B | `(none)` | prod emits no ui_access_point/link_name (we emit — superset) |
| `product_banner` | 4 | 4 | 89% | A | `product_banner` | no product-banner block in our port |
| `author_bio` | 4 | 4 | 100% | — | `author_bio` |  |
| `dynamic_category_container` | 2 | 1 | 91% | A | `dynamic_category_container|qrc_content_card_grid|qrc_content_card|video` | per-thumbnail card tracking (#769) |
| `arrow-left` | 1 | 1 | 100% | — | `page` |  |
| `arrow-right` | 1 | 1 | 100% | — | `page` |  |
| `video_link` | 1 | 1 | 91% | B | `page` | link_name over-production |
| `feature` | 1 | 1 | 91% | B | `feature|video` | video trail |

## Field matrix

Each cell: **✓** match · **N✗** N events differ · **·** field not populated by prod here.

| Component | event | object | obj_det | action | ui_obj | ui_od | ui_act | ui_ap | wa | icom | link_nm |
|---|--|--|--|--|--|--|--|--|--|--|--|
| `page` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 33✗ |
| `footer` | ✓ | ✓ | · | ✓ | ✓ | 1✗ | ✓ | 1✗ | ✓ | ✓ | ✓ |
| `faq` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 13✗ | ✓ | ✓ | ✓ |
| `testimonial` | ✓ | ✓ | · | ✓ | ✓ | 21✗ | ✓ | 12✗ | · | · | ✓ |
| `video` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 33✗ | ✓ | ✓ | ✓ |
| `secondary-nav` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 30✗ | · | · | · |
| `case-study-header` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 17✗ | · | · | ✓ |
| `talk-to-sales` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `toc` | ✓ | ✓ | · | ✓ | ✓ | 20✗ | ✓ | ✓ | · | · | · |
| `button` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9✗ | ✓ | ✓ | 10✗ |
| `disclaimer` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 17✗ | ✓ | ✓ | 5✗ |
| `social` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ |
| `cards` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5✗ | ✓ | ✓ | ✓ |
| `nav` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · |
| `cta` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2✗ |
| `hero` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `image` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 3✗ | ✓ | ✓ | ✓ |
| `quick_links` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ |
| `related-blogs` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 5✗ | · | · | ✓ |
| `link` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 4✗ | ✓ | ✓ | 3✗ |
| `product_banner` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 4✗ | · | · | 1✗ |
| `author_bio` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `dynamic_category_container` | ✓ | ✓ | · | ✓ | ✓ | · | ✓ | 2✗ | · | · | · |
| `arrow-left` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ |
| `arrow-right` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ |
| `video_link` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | 1✗ |
| `feature` | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 1✗ | · | · | ✓ |

## Structural (non-CTA) — prod tracks per-element, our cards are single-anchor (#769)

| Component | Elements | Note |
|---|--:|---|
| `dynamic_category_container` | 76 | blog-index category/card grid — per img/picture/div |
| `related-blogs` | 53 | in-article related cards — per img/picture/div |
| `secondary-nav` | 6 | non-CTA sub-elements |
| `pause-button` | 1 | carousel pause control |
