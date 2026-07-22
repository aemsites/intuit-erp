#!/usr/bin/env python3
"""Fill an OF1 template HTML file with slot values from a JSON file.

Usage:
    python3 fill-template.py templates/of1-comparison.html sample.json drafts/out.html

Slot conventions (matching templates/of1-*.metadata.json):
  text  : element has data-slot="key"           — sets innerHTML to value
  image : <img data-slot="key">                 — sets src/alt
  link  : <a data-slot="key">                   — sets href + label
  list  : element has data-slot-list="key"      — replaces innerHTML with <li> per item
"""

import json
import re
import sys
import os
from html import escape as html_escape


def escape_attr(s):
    return str(s or '').replace('"', '&quot;')


def fill_slot(html, key, value):
    if value is None:
        return html
    escaped_key = re.escape(key)
    pattern = re.compile(
        rf'(<([a-z][\w-]*)([^>]*?)\sdata-slot="{escaped_key}"([^>]*)>)([\s\S]*?)(</\2>)',
        re.IGNORECASE
    )

    def replacer(m):
        open_tag, tag_name, before_attrs, after_attrs, inner, close_tag = m.groups()
        tag = tag_name.lower()

        if tag == 'img':
            return m.group(0)

        if tag == 'a':
            if isinstance(value, dict):
                href = value.get('href', '#')
                label = value.get('label', '')
            else:
                href = '#'
                label = str(value)
            new_open = re.sub(r'\shref="[^"]*"', '', open_tag)
            new_open = new_open.replace('<a', f'<a href="{escape_attr(href)}"', 1)
            return f'{new_open}{html_escape(str(label))}{close_tag}'

        # Text slot
        if isinstance(value, dict) and 'html' in value:
            inner2 = value['html']
        else:
            inner2 = html_escape(str(value))
        return f'{open_tag}{inner2}{close_tag}'

    return pattern.sub(replacer, html)


def fill_img_slot(html, key, value):
    if value is None:
        return html
    if isinstance(value, dict):
        src = value.get('src', '')
        alt = value.get('alt', '')
    else:
        src = str(value)
        alt = ''
    escaped_key = re.escape(key)
    pattern = re.compile(
        rf'<img([^>]*?)\sdata-slot="{escaped_key}"([^>]*?)>',
        re.IGNORECASE
    )

    def replacer(m):
        before, after = m.groups()
        stripped = re.sub(r'\s(src|alt)="[^"]*"', '', before + after)
        return f'<img{stripped} src="{escape_attr(src)}" alt="{escape_attr(alt)}" data-slot="{key}">'

    return pattern.sub(replacer, html)


def fill_list_slot(html, key, items):
    if not isinstance(items, list) or len(items) == 0:
        return html
    escaped_key = re.escape(key)
    pattern = re.compile(
        rf'(<([a-z][\w-]*)([^>]*?)\sdata-slot-list="{escaped_key}"([^>]*)>)([\s\S]*?)(</\2>)',
        re.IGNORECASE
    )
    li_html = ''.join(f'<li>{html_escape(str(item))}</li>' for item in items)

    def replacer(m):
        open_tag = m.group(1)
        close_tag = m.group(6)
        return f'{open_tag}{li_html}{close_tag}'

    return pattern.sub(replacer, html)


def main():
    if len(sys.argv) != 4:
        print('usage: fill-template.py <template.html> <values.json> <out.html>', file=sys.stderr)
        sys.exit(2)

    template_path, values_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    with open(template_path, 'r', encoding='utf-8') as f:
        template = f.read()

    with open(values_path, 'r', encoding='utf-8') as f:
        values = json.load(f)

    # Count items for grid
    item_count = sum(1 for k in ['item-1', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6']
                     if values.get(f'{k}.title') or values.get(f'{k}.body'))

    out = template

    for key, value in values.items():
        if key.startswith('_'):
            continue
        if isinstance(value, list):
            out = fill_list_slot(out, key, value)
        elif isinstance(value, dict) and 'src' in value:
            out = fill_img_slot(out, key, value)
        else:
            out = fill_img_slot(out, key, value)
            out = fill_slot(out, key, value)

    # Strip unfilled image slots
    out = re.sub(r'<img[^>]*\sdata-slot="[^"]+"[^>]*>', lambda m: m.group(0) if 'src="' in m.group(0) and 'src=""' not in m.group(0) else '', out)

    # Hide unused cards
    def hide_card(m):
        attrs, idx = m.group(1), m.group(2)
        key_match = re.search(r'\sdata-card-key="([^"]+)"', attrs)
        probe_key = key_match.group(1) if key_match else f'item-{idx}.title'
        fallback_key = None if key_match else f'item-{idx}.body'
        present = values.get(probe_key) is not None or (fallback_key and values.get(fallback_key) is not None)
        if present:
            return m.group(0)
        if ' hidden' in attrs:
            return m.group(0)
        return f'<article{attrs} hidden>'

    out = re.sub(r'<article([^>]*?\sdata-card="(\d+)"[^>]*)>', hide_card, out)

    # Mark grid with item count
    out = out.replace(
        '<div class="of1-cmp-grid" data-grid-items>',
        f'<div class="of1-cmp-grid" data-grid-items data-item-count="{item_count}">'
    )

    # Wrap in standalone page
    stylesheet = values.get('_meta', {}).get('stylesheet', '/styles/of1-template-base.css')
    title = values.get('hero.title', 'Template Preview')

    standalone = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html_escape(str(title))}</title>
  <link rel="stylesheet" href="{escape_attr(stylesheet)}">
</head>
<body>
{out}
</body>
</html>
'''

    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(standalone)

    print(f'wrote {out_path} ({len(standalone)} bytes, {item_count} items)')


if __name__ == '__main__':
    main()
