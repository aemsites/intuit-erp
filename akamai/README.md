# Akamai EdgeWorker — inline header & footer into the HTML payload

**Audience:** the Akamai CDN team fronting `stage.erp.intuit.com` (and, later, production).

This EdgeWorker inlines the site's **header (nav)** and **footer** fragments into the
initial HTML document at the edge, and — critically — **forwards the `edge-cache-tag`**
from each fragment onto the page so Adobe's **push invalidation** keeps working after
inlining. It is a faithful Akamai port of Adobe's Cloudflare/Fastly reference,
[`adobe-rnd/helix-mixer` `src/inlines.js`](https://github.com/adobe-rnd/helix-mixer/blob/main/src/inlines.js).

---

## 1. Why

Pages are served by aem.live with **empty** `<header></header>` and `<footer></footer>`;
the browser currently makes two extra requests (`/nav.plain.html`, `/footer.plain.html`)
to build the chrome. Inlining them at the edge removes those round-trips and puts the
nav/footer in the first byte (better a11y landmarks + crawlability).

**The catch — cache invalidation.** aem.live uses *push invalidation*: when content
changes it calls the Akamai **Fast Purge API** (Delete by URL **and** Delete by cache
tag). Each response carries an `Edge-Cache-Tag`. Once we inline `/nav` into a page, a
change to the nav must purge **every page that inlined it**. So when we inline a fragment
we must **union that fragment's `edge-cache-tag` into the page's `edge-cache-tag`** before
the page is cached. That union is the whole point of this worker.

## 2. Scope — header & footer only

Only the empty-`<header>` / empty-`<footer>` inlining path is ported. The reference also
inlines arbitrary fragments (`#inline` / path-prefix). **That is intentionally NOT
included** — no anchor scanning, no path-prefix fragments.

## 3. What it injects

For each fragment it fetches `…​.plain.html` and injects it **wrapped in a `<nav>`
landmark**, dumping the raw EDS markup inside:

```html
<header>
  <nav>
    <!-- raw /nav.plain.html markup (EDS div soup) -->
  </nav>
</header>
<footer>
  <nav>
    <!-- raw /footer.plain.html markup -->
  </nav>
</footer>
```

The front-end (`blocks/header/header.js`, `blocks/footer/footer.js`) reads that markup from
`header > nav` / `footer > nav`, decorates it into the styled chrome, and removes the raw
`<nav>`. If the markup is absent (e.g. worker off), the front-end falls back to fetching
`.plain.html` itself — so the two sides are **decoupled and independently deployable**.

### Fragment paths (defaults + overrides)

- Default `/nav` and `/footer`.
- A page may override via `<meta name="nav" content="…">` / `<meta name="footer" content="…">`.
- Skipped when `<meta name="hide-header">` / `<meta name="hide-footer">` is `true`/`yes`/`hide`
  (the front-end removes those elements, so inlining would be wasted).

## 4. Request/response header contract

**Forwarded to origin on the page fetch AND both fragment subrequests** (mirrors the
property's own origin request headers):

| Header | Value | Why |
| --- | --- | --- |
| `X-Forwarded-Host` | the incoming host (`{{builtin.AK_HOST}}`) | aem.live routing |
| `X-BYO-CDN-Type` | `akamai` | makes aem.live emit `Edge-Cache-Tag` (Akamai format) |
| `X-Push-Invalidation` | `enabled` | opt into push invalidation |
| `Authorization` | `token <site-auth>` | origin **site-auth is ON** — every subrequest 401s without it |

> The site-auth token is read from a Property Manager user variable
> **`PMUSER_ORIGIN_AUTH`** (see `src/main.js` → `forwardHeaders`). Keep the secret in
> Property Manager, never in worker code. If the property already appends `Authorization`
> to *all* origin-bound requests (including EdgeWorker subrequests), the variable can be
> left empty.

**Response:** the composed page keeps the origin page's headers, drops `Content-Length` /
`Content-Encoding` (the body is rewritten and emitted uncompressed — the CDN recompresses),
and sets `Edge-Cache-Tag` = **union(page tags, nav tags, footer tags)**.

## 5. Files & bundling

```
akamai/
  bundle.json     # EdgeWorkers manifest
  src/
    main.js       # responseProvider — runtime I/O (subrequests, response)
    inline.js     # pure inlining + cache-tag logic (unit-tested in repo: test/akamai-inline.test.js)
```

`src/main.js` uses an ES `import` of `./inline.js`. EdgeWorkers expects **`main.js` and
`bundle.json` at the tarball root**, so bundle to a single file first, e.g.:

```bash
npx esbuild akamai/src/main.js --bundle --format=esm \
  --external:http-request --external:create-response --external:streams --external:log \
  --outfile=dist/main.js
cp akamai/bundle.json dist/ && tar -C dist -czf akamai-inline.tgz main.js bundle.json
```

(The `http-request`, `create-response`, `streams`, `log` modules are Akamai built-ins and
must stay external.)

## 6. Property Manager requirements (your side)

1. **Attach the EdgeWorker as a `responseProvider` on HTML documents only.** Exclude
   `*.plain.html`, `*.json`, and all assets — otherwise fragment subrequests recurse and
   assets pay needless compute.
2. **Provide the origin auth token** as `PMUSER_ORIGIN_AUTH` (or append `Authorization` to
   origin-bound requests property-wide).
3. **Cache the composed output** — honor origin `Edge-Control` / `Cache-Control` so the
   inlined page is cached at the edge, not recomputed per request.
4. **Honor the response `Edge-Cache-Tag` for Fast Purge tag indexing** (see Open items #1).
5. Keep the existing **Fast Purge** credentials wired (Delete by URL + Delete by cache tag)
   — this is the standard aem.live Akamai push-invalidation setup; no change needed.

## 7. EdgeWorkers limits this design respects

- **Body must be a stream.** A string body in `responseProvider` caps at **16 KB**; pages
  are larger (homepage ≈ 64 KB), so the worker returns a `ReadableStream`.
- **Subrequests:** HTTPS only, no port, ≤ 5 MB response, ≤ **1 s** wall-time each. Nav/footer
  are tiny; two are fetched in parallel.

## 8. Verification

```bash
# Composed page has inlined <header><nav>…</nav></header> + <footer><nav>…</nav></footer>
curl -s https://stage.erp.intuit.com/accounting/ | grep -oE '<header>|<nav>|<footer>'

# Push-invalidation smoke test:
#  1. load a page (warms edge cache, now carries the nav's edge-cache-tag)
#  2. change /nav content in DA and publish (aem.live Fast-Purges the nav's tag)
#  3. reload the page — the inlined nav reflects the change (page was purged via the union)
```

Unit tests for the pure logic live in the site repo: `npm test` → `test/akamai-inline.test.js`.

## 9. Open validation items

1. **Cache-tag honoring in `responseProvider`.** Confirm Akamai indexes the `Edge-Cache-Tag`
   *set by the EdgeWorker response* for Fast Purge "Delete by cache tag" (normally the tag is
   read from the origin response). If it does not, set the tag via an `onOriginResponse`
   handler / PMUSER variable feeding a Property Manager **Cache Tag** behavior instead.
2. **responseProvider cacheability** — verify the composed page is actually cached at the edge.
3. **Attach scope** — verify the worker never runs on `*.plain.html` / JSON / assets.

## 10. Rollout

The front-end change (consume-inlined-else-fetch) is **backward-compatible** and ships first;
it no-ops until this worker starts injecting markup. Then: enable the worker on the Akamai
**staging** network → validate §8 → `stage.erp.intuit.com` → production.
