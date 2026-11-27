import type { Component, TUI } from "@earendil-works/pi-tui";

/**
 * Pi's fullscreen renderer treats any visible overlay as modal in two places, including non-capturing
 * ones: a new text selection is not attached to the transcript (so dragging past an edge does not
 * auto-scroll and the selection does not follow scrolling), and the scrollbar ignores hover and drag.
 * Both checks call `hasOverlay()` (pi-tui 1.6.x `tui-alt-screen.js`). The sticky bar is decoration,
 * so the renderer gets a `hasOverlay()` that skips it.
 *
 * Symbol.for keys keep the marker and the patch compatible across extension reloads, which reuse
 * the renderer but load a fresh copy of this module.
 */
const STICKY_BAR = Symbol.for("pi-sticky-prompt/bar");
const PATCHED = Symbol.for("pi-sticky-prompt/has-overlay-patched");

/** Mark a component so the patched `hasOverlay()` ignores its overlay. */
export function markStickyBar<T extends Component>(component: T): T {
	(component as unknown as Record<symbol, boolean>)[STICKY_BAR] = true;
	return component;
}

interface OverlayRenderer {
	overlayStack?: unknown;
	isOverlayVisible?: (entry: unknown) => boolean;
}

function hasOverlayIgnoringStickyBar(this: OverlayRenderer): boolean {
	const stack = this.overlayStack;
	const isVisible = this.isOverlayVisible;
	if (!Array.isArray(stack) || typeof isVisible !== "function") {
		// Unknown internals: defer to Pi's own method.
		const original = (Object.getPrototypeOf(this) as { hasOverlay?: () => boolean }).hasOverlay;
		return typeof original === "function" ? original.call(this) : false;
	}
	return stack.some((entry: { component?: Record<symbol, unknown> } | null) => {
		if (entry?.component?.[STICKY_BAR] === true) return false;
		return isVisible.call(this, entry);
	});
}

/**
 * Install the patch on the renderer behind `tui` once. `tui` is Pi's renderer reference, which
 * forwards property reads and writes to the current renderer, so this patches that instance only.
 */
export function ignoreStickyBarInHasOverlay(tui: TUI): void {
	const renderer = tui as unknown as Record<PropertyKey, unknown>;
	if (tui.mode !== "fullscreen" || renderer[PATCHED] === true) return;
	if (typeof renderer.hasOverlay !== "function") return;
	renderer.hasOverlay = hasOverlayIgnoringStickyBar;
	renderer[PATCHED] = true;
}
