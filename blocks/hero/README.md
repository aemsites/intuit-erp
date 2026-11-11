# Hero

The dark lead band at the top of a page. Author one block named `Hero` (plus any variants in
parentheses, e.g. `Hero (video-bg)`) with the copy in a single cell:

1. Eyebrow paragraph (optional, before the heading)
2. Headline (`h1`, `h2` or `h3`)
3. Supporting copy paragraph(s)
4. CTA links: **bold** for a primary button, *italic* for a secondary one. YouTube/Vimeo links
   open in a video lightbox.
5. Media (image, `.mp4` link) as each variant below describes.

## `video-bg`: full-bleed background video

`Hero (video-bg)` plays a muted, looping video edge to edge behind the headline, copy and CTAs.

| Authored content | Purpose |
| --- | --- |
| Eyebrow, headline, copy, CTAs | Rendered above the video, as in every hero. |
| 1st `.mp4` link | Background video (all widths). |
| 2nd `.mp4` link (optional) | Background video below 1024px. |
| 1st image | Static fallback / poster (all widths). |
| 2nd image (optional) | Static fallback below 1024px. |

The `.mp4` links and images can sit anywhere in the cell; they are taken out of the copy.

Behavior:

- The video autoplays muted and inline and loops with no teaser cut-off or play overlay.
- A pause/resume button in the bottom-right corner is reachable by keyboard and labelled
  "Pause background video" / "Play background video".
- The static fallback image is shown instead of the video when the visitor prefers reduced
  motion, the browser blocks autoplay (the button can still start it), the video fails to load
  (the button is removed), or no `.mp4` link is authored. Without an image the section's navy
  background shows.

Assets:

- Use a short, compressed, silent `.mp4`; it is cover-cropped, so keep the subject centered.
- Use the first frame (same aspect ratio) as the fallback image so the switch to video is
  seamless.

## Other variants

- `form`: copy beside a lead-form card (`/fragments/...` path cell; defaults to
  `/fragments/schedule-call`).
- `centered`: single column; an image is a logo lockup above the headline; an `.mp4` link plays
  a looping video below the copy with a pause/resume button.
- `gradient`: gradient section background.
- `video-link`: the first YouTube/Vimeo link becomes a text link with a duration.
- `ies-gradient`: Blueberry hero on a blue/lavender gradient (CSS, so a section background image
  still overrides it). Copy left and media right from 1024px; a left-aligned stack below. Images: the
  media (dashboard stack) can sit in its own row; an image in the same cell as the headline,
  above it, is the product lockup (e.g. "intuit intelligence"). Without that image, a text
  eyebrow paragraph is used. Pair with section style `ies, dark-background`.
- `ies`: Blueberry IES styling; combine with `arcs` or `glow` for the backgrounds.
- `ies video`: `.mp4` links (desktop, then below 1024px) play a 5-second teaser tile with a
  play button; images are its posters. Instead of an `.mp4`, a plain (not bold/italic) YouTube
  link (`youtube.com/watch?v=`, `youtu.be/` or `youtube.com/embed/`) shows a poster with a play
  button; the YouTube player loads only when the visitor clicks play and plays in the tile.
  Posters are the authored images (desktop, then below 1024px), else the YouTube thumbnail.
  Author one source: if an `.mp4` is present it wins. Bold/italic YouTube links stay CTA buttons
  that open the video lightbox.
- `homepage`: homepage sizing for `ies video`.
- `background-image`: the image fills the hero behind the copy.
- `image-glow`: blue glow behind the hero image.
- `light` (section style): light background with dark text.
