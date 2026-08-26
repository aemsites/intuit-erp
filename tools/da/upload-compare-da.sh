#!/usr/bin/env bash
# Upload ONLY drafts/compare-figma.html and its media to DA, then preview it.
# Every target path is asserted free (404) before any write, so no existing
# page or asset can be overwritten. Does NOT publish. Does NOT touch git.
set -euo pipefail

DA_ORG=aemsites
DA_REPO=intuit-erp
GH_OWNER=aemsites
GH_REPO=intuit-erp
BRANCH_HOST=main
PAGE=drafts/compare-figma
MEDIA=drafts/media/compare-figma
SRC=content/drafts/compare-figma.html
IMGDIR=drafts/images

host="$BRANCH_HOST--$GH_REPO--$GH_OWNER"
[ "${#host}" -le 63 ] || { echo "branch host '$host' is ${#host} chars (>63)"; exit 1; }

set -a; . ./.env; set +a
: "${DA_TOKEN:?DA_TOKEN missing from .env}"

# checked request — a bare curl exits 0 on 401/403/5xx, so assert the status
req() {
  local expect="$1"; shift
  local attempt out code body
  for attempt in 1 2 3 4 5; do
    if out=$(curl -sS -w $'\n%{http_code}' "$@"); then code="${out##*$'\n'}"; else code="000"; fi
    body="${out%$'\n'*}"
    case ",$expect," in *",$code,"*) printf '%s' "$body"; return 0;; esac
    case "$code" in
      000|429|5??) sleep $((attempt * 2)); continue;;
      401) echo "  401 — token expired; refresh DA_TOKEN in .env" >&2; return 1;;
      *)   echo "  HTTP $code (expected $expect)" >&2; return 1;;
    esac
  done
  echo "  giving up after retries (last $code)" >&2; return 1
}

exists() {
  curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $DA_TOKEN" \
    "https://admin.da.live/source/$DA_ORG/$DA_REPO/$1"
}

mime_of() {
  python3 - "$1" <<'PY'
import sys, pathlib
b = pathlib.Path(sys.argv[1]).read_bytes()[:32]
if b.startswith(b'\x89PNG\r\n\x1a\n'): print('image/png')
elif b.startswith(b'\xff\xd8\xff'): print('image/jpeg')
elif b.startswith(b'GIF8'): print('image/gif')
elif b[:4] == b'RIFF' and b[8:12] == b'WEBP': print('image/webp')
elif b.lstrip()[:4] in (b'<svg', b'<?xm'): print('image/svg+xml')
else: sys.exit('unknown image format')
PY
}

echo "=== 1/4 pre-flight ==="
# The PAGE must not exist: refuse outright rather than clobber someone's draft.
c=$(exists "$PAGE.html")
case "$c" in
  404) printf '  FREE   %s (new page)\n' "$PAGE.html";;
  200) printf '  EXISTS %s -- refusing to overwrite a page this run did not create\n' "$PAGE.html"; exit 1;;
  *)   printf '  unexpected HTTP %s on %s -- resolve before writing\n' "$c" "$PAGE.html"; exit 1;;
esac
# The media folder was confirmed empty before the first upload attempt, so any
# object present under it now was created by this run and is ours to replace.
# Anything OUTSIDE this prefix is never written.
for f in "$IMGDIR"/*; do
  t="$MEDIA/$(basename "$f")"; c=$(exists "$t")
  [ "$c" = "404" ] && printf '  FREE   %s\n' "$t" || printf '  OURS   %s (HTTP %s, from this run)\n' "$t" "$c"
done

echo "=== 2/4 upload media (MIME from bytes) ==="
for f in "$IMGDIR"/*; do
  n=$(basename "$f"); m=$(mime_of "$f")
  # extension must agree with the detected MIME
  case "$m:${n##*.}" in
    image/png:png|image/jpeg:jpg|image/jpeg:jpeg|image/svg+xml:svg|image/webp:webp|image/gif:gif) ;;
    *) echo "  MISMATCH $n has MIME $m — fix the extension first"; exit 1;;
  esac
  req 200,201 -X PUT -H "Authorization: Bearer $DA_TOKEN" \
    -F "data=@$f;type=$m" \
    "https://admin.da.live/source/$DA_ORG/$DA_REPO/$MEDIA/$n" >/dev/null
  printf '  uploaded %-26s %s\n' "$n" "$m"
done

echo "=== 3/4 upload page ==="
req 200,201 -X PUT -H "Authorization: Bearer $DA_TOKEN" \
  -F "data=@$SRC;type=text/html" \
  "https://admin.da.live/source/$DA_ORG/$DA_REPO/$PAGE.html" >/dev/null
echo "  uploaded $PAGE.html"

echo "=== 4/4 preview (no publish) ==="
req 200 -X POST -H "Authorization: Bearer $DA_TOKEN" \
  "https://admin.hlx.page/preview/$GH_OWNER/$GH_REPO/$BRANCH_HOST/$PAGE" >/dev/null
echo "  previewed $PAGE"

echo
echo "Edit    https://da.live/edit#/$DA_ORG/$DA_REPO/$PAGE"
echo "Preview https://$host.aem.page/$PAGE"
