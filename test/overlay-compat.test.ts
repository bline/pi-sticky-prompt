import assert from "node:assert/strict";
import { test } from "node:test";
import { TuiAltScreen, type Component, type TUI } from "@earendil-works/pi-tui";
import { ignoreStickyBarInHasOverlay, markStickyBar } from "../src/overlay-compat.ts";

const component = (): Component => ({ render: () => [], invalidate: () => {} });

interface OverlayEntry {
	component: Component;
	hidden: boolean;
	options: object;
}
/** The renderer internals the patch relies on, which are private in Pi's types. */
interface Raw {
	mode: string;
	overlayStack: OverlayEntry[];
	hasOverlay(): boolean;
}

/** A renderer built on pi-tui's real prototype, so Pi's own overlay visibility rules apply. */
function renderer(overlays: { component: Component; options?: object }[]): Raw {
	const tui = Object.create(TuiAltScreen.prototype) as Raw;
	Object.assign(tui, {
		mode: "fullscreen",
		overlayStack: overlays.map((o) => ({ hidden: false, options: {}, ...o })),
		terminal: { columns: 100, rows: 30 },
	});
	return tui;
}
const asTui = (raw: object) => raw as unknown as TUI;

test("Pi's own hasOverlay counts a visible non-capturing overlay (the reason for the patch)", () => {
	const tui = renderer([{ component: markStickyBar(component()), options: { nonCapturing: true } }]);
	assert.equal(tui.hasOverlay(), true);
});

test("the patched hasOverlay ignores the sticky bar but still sees other overlays", () => {
	const tui = renderer([{ component: markStickyBar(component()), options: { nonCapturing: true } }]);
	ignoreStickyBarInHasOverlay(asTui(tui));
	assert.equal(tui.hasOverlay(), false);

	tui.overlayStack.push({ component: component(), hidden: false, options: {} });
	assert.equal(tui.hasOverlay(), true);
	tui.overlayStack[1]!.hidden = true;
	assert.equal(tui.hasOverlay(), false);
});

test("the patch is installed once and skips non-fullscreen renderers", () => {
	const tui = renderer([]);
	ignoreStickyBarInHasOverlay(asTui(tui));
	const patched = tui.hasOverlay;
	ignoreStickyBarInHasOverlay(asTui(tui));
	assert.equal(tui.hasOverlay, patched);

	const regular = renderer([]);
	regular.mode = "regular";
	ignoreStickyBarInHasOverlay(asTui(regular));
	assert.equal(Object.hasOwn(regular, "hasOverlay"), false);
});

test("a renderer without the expected internals falls back to its own hasOverlay", () => {
	const unknown = Object.create({ hasOverlay: () => true }) as { mode: string; hasOverlay(): boolean };
	unknown.mode = "fullscreen";
	ignoreStickyBarInHasOverlay(asTui(unknown));
	assert.equal(Object.hasOwn(unknown, "hasOverlay"), true);
	assert.equal(unknown.hasOverlay(), true);
});
