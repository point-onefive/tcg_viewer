# Chart Race default head images

Drop the head-of-line avatar artwork for the **default** `/chart-race`
sample chart here, then wire the paths into `DEFAULT_HEAD_IMAGES` in
[`src/lib/chart-race-types.ts`](../../../src/lib/chart-race-types.ts).

## Files expected

| Series      | Suggested filename | Wire into            |
| ----------- | ------------------ | -------------------- |
| OP booster  | `op.png`           | `DEFAULT_HEAD_IMAGES.opbox`   |
| S&P 500     | `sp500.png`        | `DEFAULT_HEAD_IMAGES.sp500`   |
| Bitcoin     | `bitcoin.png`      | `DEFAULT_HEAD_IMAGES.bitcoin` |

Then set, e.g.:

```ts
const DEFAULT_HEAD_IMAGES = {
  opbox: '/images/chart-race/op.png',
  sp500: '/images/chart-race/sp500.png',
  bitcoin: '/images/chart-race/bitcoin.png',
}
```

Leaving any value `undefined` renders that line's head as the plain
coloured dot (no broken-image request), so a partial set is fine.

## Image specs

- **Square** (the badge clips to a circle; non-square is centre-cropped).
- ~96 to 256 px per side is plenty; the badge renders at ~32 px.
- `.png`, `.webp`, or `.jpg`. Transparent PNG/WebP looks best for logos.
- Keep them small (a few KB to tens of KB) since they ship in the bundle.

> User-pasted/uploaded images in the tool itself do NOT live here. Those
> are stored as downscaled `data:` URLs in the per-browser persisted
> store (`tcw-chart-race`). This folder is only for the shipped default.
