# Promo Banner

A full-width navy strip that announces an offer: one line of promo copy with a highlighted offer
label, and a single button. Author one block named `Promo Banner` with one row of two cells:

| Cell | Content |
| --- | --- |
| 1 | Promo text. Wrap the offer in double curly braces to highlight it, e.g. `{{50% OFF}}`. |
| 2 | One link: the link text is the button label, the link URL is its destination. |

If the block has only one cell, the last link in that cell becomes the button and is taken out of
the text.

## Offer label

- `{{50% OFF}}` renders as **50% OFF** in bright green bold; the braces are not shown.
- Type the braces and the label as one plain, unformatted run of text (no bold, italic or link
  inside the braces), otherwise the label is not recognised.
- More than one label is allowed: `{{Save 20%}} on {{QuickBooks}}`.
- Text without braces renders as normal white text. Empty braces (`{{}}`) are shown as typed.

## Button

- Always rendered as the white primary button (navy text) used on navy sections; bold or italic
  link formatting is optional and does not change its style.
- It is a regular link, so it is reachable by keyboard and shows a focus outline.

## Layout

- Below 768px: at least 136px tall, text on the left (wrapping as needed) and the button on the
  right, both vertically centered.
- From 768px: at least 80px tall, text and button in one row centered horizontally and
  vertically.
- Long copy grows the band instead of overflowing or overlapping the button.

## Example

| Promo Banner | |
| --- | --- |
| Get {{50% OFF}} QuickBooks for 3 months* | [Buy now](https://example.com/buy) |

Renders as "Get **50% OFF** QuickBooks for 3 months*" with a **Buy now** button linking to the
authored URL.
