#!/usr/bin/env python3
"""
Convert drafts/compare.plain.html (local-preview form) into the DA body-fragment
form at content/drafts/compare-figma.html.

Transforms the DA form requires (da-content html-content.md):
  1. wrap the bare section divs in <body><header></header><main>…</main><footer></footer>
  2. rewrite /drafts/images/* srcs to full https://content.da.live/{org}/{repo}/… URLs
     (repo-relative image paths render as about:error in DA)
  3. drop authored heading id= attributes — the pipeline generates them from the
     heading text, and authored ids are stripped and regenerated
  4. <cite>X</cite> -> <p>&lt;cite&gt;X</p>. `<cite>` is NOT in the cell-normalization
     preserve list (§3.9), so DA unwraps it and the attribution would leak into the
     panel body. tabs.js supports a literal "<cite>" TEXT prefix for exactly this
     case (CITE_PREFIX), which survives the pipeline.
  5. append the required `metadata` block as the last element of the last section

Usage: build-compare-da.py <da-org> <da-repo>
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / 'drafts' / 'compare.plain.html'
OUT = ROOT / 'content' / 'drafts' / 'compare-figma.html'
MEDIA_PREFIX = 'drafts/media/compare-figma'

IMAGES = [
    'hero-dashboard.png',
    'forrester.svg',
    'trustradius.png',
    'g2-medal.svg',
    'ies-logo.png',
    'sage-logo.svg',
    'jtbd-redhammer.jpg',
]


def main():
    if len(sys.argv) != 3:
        sys.exit('usage: build-compare-da.py <da-org> <da-repo>')
    org, repo = sys.argv[1], sys.argv[2]
    base = f'https://content.da.live/{org}/{repo}/{MEDIA_PREFIX}'

    html = SRC.read_text()

    # 2. images -> full DA content URLs
    for name in IMAGES:
        html = html.replace(f'/drafts/images/{name}', f'{base}/{name}')
    leftover = re.findall(r'/drafts/images/[^"\']+', html)
    if leftover:
        sys.exit(f'unmapped local image refs remain: {sorted(set(leftover))}')

    # 3. strip authored heading ids
    html = re.sub(r'(<h[1-6]) id="[^"]*"', r'\1', html)

    # 4. real <cite> -> DA-safe literal-prefix paragraph
    html, n_cite = re.subn(
        r'<cite>(.*?)</cite>',
        lambda m: f'<p>&lt;cite&gt;{m.group(1)}</p>',
        html,
        flags=re.S,
    )

    # 5. metadata block, appended inside the final section
    metadata = (
        '  <div class="metadata">\n'
        '    <div>\n'
        '      <div>title</div>\n'
        '      <div>Intuit Enterprise Suite vs Sage Intacct</div>\n'
        '    </div>\n'
        '    <div>\n'
        '      <div>description</div>\n'
        '      <div>Manage every entity from one view and consolidate at a fraction of '
        'Sage Intacct&#39;s total cost.</div>\n'
        '    </div>\n'
        '    <div>\n'
        '      <div>image</div>\n'
        f'      <div>{base}/hero-dashboard.png</div>\n'
        '    </div>\n'
        '  </div>\n'
    )
    if not html.rstrip().endswith('</div>'):
        sys.exit('unexpected draft tail; refusing to guess where the last section ends')
    tail_idx = html.rstrip().rfind('\n</div>')
    html = html.rstrip()[:tail_idx] + '\n' + metadata + '</div>\n'

    # 1. document skeleton, sections indented one level into <main>
    body = '\n'.join(f'  {line}' if line.strip() else line
                     for line in html.rstrip().split('\n'))
    doc = ('<body>\n'
           '  <header></header>\n'
           '  <main>\n'
           f'{body}\n'
           '  </main>\n'
           '  <footer></footer>\n'
           '</body>\n')

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(doc)

    print(f'wrote {OUT.relative_to(ROOT)}')
    print(f'  top-level sections   : {len(re.findall(r"^    <div>$", doc, re.M))}')
    print(f'  metadata blocks      : {doc.count(chr(34) + "metadata" + chr(34))}')
    print(f'  DA image URLs        : {doc.count(base)}')
    print(f'  local /drafts/images : {len(re.findall(r"/drafts/images/", doc))}')
    print(f'  authored heading ids : {len(re.findall(r"<h[1-6] id=", doc))}')
    print(f'  <cite> converted     : {n_cite}  (raw <cite> left: '
          f'{len(re.findall(r"<cite>", doc))})')
    print(f'  div balance          : {len(re.findall(r"<div[ >]", doc))} open / '
          f'{doc.count("</div>")} close')


if __name__ == '__main__':
    main()
