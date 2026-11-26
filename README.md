# pi-sticky-prompt

A Pi extension that pins a user prompt to the top of the fullscreen transcript, like a sticky header. The bar is the prompt's first line followed by a blank row in Pi's user-message colour.

As you scroll, the bar shows the prompt whose turn you are reading: the last prompt whose first line has scrolled under the bar or above it. While the next prompt is still visible just below the bar, the previous prompt stays pinned. The bar switches when that next prompt's first line slides under it.

Tested with Pi 1.6.0 and 1.6.1.

## Install

```sh
pi -e /path/to/pi-sticky-prompt          # one run
pi install /path/to/pi-sticky-prompt     # keep it installed
```

`/sticky-prompt [on|off]` shows or hides the bar.

## Limits

- **Fullscreen mode only.** In regular mode, the terminal owns scrollback, so Pi never sees scrolling and an extension cannot follow it. The bar is not created in regular mode, because overlays also change how regular mode renders.
- **Mode switching.** Pi refuses to change TUI mode while any overlay exists. The bar removes itself while the settings list has focus and comes back after you close it.
- **Pi internals.** Pi's extension API has no scroll event and does not expose prompt positions. The extension reads three internal values on each frame: `viewportTop` on the fullscreen renderer, the transcript container mounted first in the TUI, and the cached per-child render output of each `Container`. If a future Pi changes any of them, the bar shows nothing; it does not throw an error. All of these reads are in `src/transcript.ts`.

## How it works

The bar is a non-capturing `ctx.ui.custom` overlay anchored top-left at full width. Pi composites overlays on every frame, including scroll-only frames that reuse cached transcript output, so the overlay's `render()` runs on each scroll. It finds `UserMessageComponent` rows in the transcript's cached layout. That lookup is cached until the transcript content changes. It then picks the prompt to pin from `viewportTop`. Mouse wheel and clicks on the bar rows still reach the transcript.

## Development

```sh
npm install
npm run check                                   # tsc
npm test                                        # unit tests
node scripts/e2e.mjs "$(command -v pi)" e2e     # tmux end-to-end run in an isolated agent dir
```
