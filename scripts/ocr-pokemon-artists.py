#!/usr/bin/env python3
"""
Phase-2 artist backfill: OCR the credit line off card scans for cards
TCGdex couldn't cover (data/pokemon-artist-backfill.json stillMissing).

Reads local webp scans (public/cards-pokemon/{id}.webp), crops the
regions where the "Illus. NAME" credit is printed (varies by era /
full-art layout), runs tesseract, and extracts the artist name.

Validation: candidates are fuzzy-matched against the vocabulary of
artists already present in the bundle (difflib ratio >= 0.87 snaps to
the canonical spelling). Unmatched but clean-looking names are kept
with a `new_name` flag for review.

Output: data/pokemon-artist-ocr.json  (does NOT touch the bundle -
apply step is scripts/apply-pokemon-artist-ocr.mjs style explicit).

Requires: tesseract, dwebp (brew install tesseract webp), Pillow.
Usage: python3 scripts/ocr-pokemon-artists.py
"""

import difflib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "src/lib/cards-pokemon.json"
REPORT = ROOT / "data/pokemon-artist-backfill.json"
IMAGES = ROOT / "public/cards-pokemon"
OUT = ROOT / "data/pokemon-artist-ocr.json"

from PIL import Image  # noqa: E402

cards = json.loads(BUNDLE.read_text())
report = json.loads(REPORT.read_text())
todo = report["stillMissing"]
print(f"OCR targets: {len(todo)}")

# Canonical artist vocabulary from the bundle for fuzzy snapping.
vocab = sorted({c["artist"] for c in cards if c.get("artist")})
vocab_lower = {v.lower(): v for v in vocab}
print(f"Known artist vocabulary: {len(vocab)}")

ILLUS_RE = re.compile(
    r"[1IiTtfJl\|\[]*[Hh]?[l1Ii\|]{1,2}us[,.:]?\s+(.{2,40})", re.IGNORECASE
)
# Text allowed in an artist name (latin letters, spaces, dots, hyphens,
# apostrophes, digits show up in handles like "5ban Graphics").
CLEAN_RE = re.compile(r"^[A-Za-z0-9À-ÿœŒ' .\-/+&()]{3,40}$")

def ocr(png_path: Path) -> str:
    try:
        r = subprocess.run(
            ["tesseract", str(png_path), "stdout", "--psm", "6"],
            capture_output=True, text=True, timeout=30,
        )
        return r.stdout
    except Exception:
        return ""

def extract_candidates(text: str):
    out = []
    for line in text.splitlines():
        m = ILLUS_RE.search(line)
        if not m:
            continue
        cand = m.group(1).strip()
        # Cut at obvious trailing junk (multiple spaces, separators, set
        # number fragments, copyright onwards).
        cand = re.split(r"\s{2,}|[|©@•·]|\d{1,3}/\d{2,3}", cand)[0].strip()
        cand = cand.strip(" .:;,-_")
        if cand:
            out.append(cand)
    return out

def snap(cand: str):
    """Snap an OCR candidate to the canonical vocabulary. Returns
    (name, kind) where kind is exact|fuzzy|new|reject."""
    low = cand.lower()
    if low in vocab_lower:
        return vocab_lower[low], "exact"
    best = difflib.get_close_matches(low, list(vocab_lower.keys()), n=1, cutoff=0.87)
    if best:
        return vocab_lower[best[0]], "fuzzy"
    if CLEAN_RE.match(cand) and any(ch.isalpha() for ch in cand):
        return cand, "new"
    return None, "reject"

# Crop regions as (left, top, right, bottom) fractions. Tried in order;
# first crop that yields an "Illus." hit wins.
CROPS = [
    (0.00, 0.91, 0.62, 1.00),  # modern SV / SwSh bottom-left
    (0.30, 0.91, 1.00, 1.00),  # bottom-right (older layouts)
    (0.00, 0.86, 1.00, 1.00),  # full bottom strip (full-arts, odd layouts)
    (0.00, 0.55, 0.55, 0.70),  # e-era / EX-era credit beside art frame
]

results = []
no_image = 0
with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    for i, item in enumerate(todo, 1):
        cid = item["id"]
        webp = IMAGES / f"{cid}.webp"
        if not webp.exists():
            no_image += 1
            results.append({**item, "ocr": None, "kind": "no-image"})
            continue
        png = tmp / f"{cid}.png"
        subprocess.run(["dwebp", "-quiet", str(webp), "-o", str(png)], capture_output=True)
        if not png.exists():
            results.append({**item, "ocr": None, "kind": "decode-failed"})
            continue
        im = Image.open(png)
        w, h = im.size
        hit = None
        for (l, t, r, b) in CROPS:
            crop = im.crop((int(w * l), int(h * t), int(w * r), int(h * b)))
            crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS).convert("L")
            cpath = tmp / "crop.png"
            crop.save(cpath)
            for cand in extract_candidates(ocr(cpath)):
                name, kind = snap(cand)
                if name and kind != "reject":
                    hit = {"ocr": cand, "artist": name, "kind": kind}
                    break
            if hit:
                break
        png.unlink(missing_ok=True)
        if hit:
            results.append({**item, **hit})
        else:
            results.append({**item, "ocr": None, "kind": "no-credit-found"})
        if i % 25 == 0:
            found = sum(1 for r in results if r.get("artist"))
            print(f"  {i}/{len(todo)} (found={found})", flush=True)

found = [r for r in results if r.get("artist")]
print(f"\nOCR done: {len(found)}/{len(todo)} extracted "
      f"(exact={sum(1 for r in found if r['kind']=='exact')}, "
      f"fuzzy={sum(1 for r in found if r['kind']=='fuzzy')}, "
      f"new={sum(1 for r in found if r['kind']=='new')}), "
      f"no_image={no_image}")
OUT.write_text(json.dumps({"results": results}, indent=2))
print(f"Report: {OUT}")
