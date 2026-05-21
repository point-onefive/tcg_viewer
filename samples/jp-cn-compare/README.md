# JP vs CN — the proof that drove deprecation

Four screenshots taken on 2026-05-21 against `localhost:3001`, captured
**before** the CN picker option was removed.

## The screenshots

| File | Mode | Content |
|---|---|---|
| `01-jp-wall.png` | JP | First page of the OP01 wall in JP mode |
| `02-jp-lightbox-OP01-016.png` | JP | OP01-016 Nami lightbox in JP mode |
| `03-cn-wall.png` | CN | Same first page of the OP01 wall in CN mode |
| `04-cn-lightbox-OP01-016.png` | CN | OP01-016 Nami lightbox in CN mode |

## What they show

Open `02` and `04` side by side. Both show the **byte-identical**
SAMPLE-watermarked Japanese-language scan of Nami — same artwork,
same Japanese card text ("ナミ", "カウンター +1000", etc.), same
SAMPLE watermark. The only visible difference is the host badge at
the bottom of the lightbox:

- JP → `JP · ONEPIECE-CARDGAME.COM`
- CN → `TC · ASIA-TC.ONEPIECE-CARDGAME.COM`

Same on the wall (`01` vs `03`): every single OP01 thumbnail is the
same Japanese SAMPLE-watermarked image with the only "diff" being
the per-tile language pill we'd just added (`JP` vs `TC`).

## Why this happens

Bandai's `asia-tc.onepiece-cardgame.com` CDN hot-links the JP CDN's
files for cards it hasn't independently localized — which is nearly
all of OP01 through about OP06. Independent confirmation via `curl`:

```text
$ curl -sL https://www.onepiece-cardgame.com/images/cardlist/card/OP01-016.png    | shasum -a 256
  295d41e0fba9c9d6ec69d1e47b1600eda632bb96fbf1c0d2bc56585ac6b22266
$ curl -sL https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP01-016.png | shasum -a 256
  295d41e0fba9c9d6ec69d1e47b1600eda632bb96fbf1c0d2bc56585ac6b22266
                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                exact same file, byte for byte
```

The SC source (`source.windoent.com`) has its own scans for a small
subset of cards (the Mainland-exclusive 1st Anniversary serialized
prints, etc.) but the bulk of its catalog is also JP-watermarked.

## Why we're deprecating the CN picker

The CN bucket promised "view Bandai's Chinese scans" but in practice
delivered "view the JP file under a different URL." That's the
worst kind of feature: it implies a difference that doesn't exist
and burns rendering cycles re-decoding identical bytes on every
language flip.

Picker is now `EN | JP` only. The SC-exclusive prints (the Nami
`OP01-016_p9_sc`, etc.) stay in the bundle so we don't lose data,
but they only render when discovered via search / drill-down rather
than via a top-level "show me Chinese cards" affordance.

Re-enabling CN later is a one-commit revert (`LanguagePickerValue`
type + `LANGUAGE_GROUPS` table + the header pill). The data is
intact; we just stopped pretending it was a separate viewable
language.
