import assert from "node:assert/strict";
import { test } from "node:test";
import { Container, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { BAR_HEIGHT, StickyPromptBar } from "../src/bar.ts";

class Prompt implements Component {
	render(): string[] {
		return ["", "PROMPT-1: a fairly long prompt that will need truncating"];
	}
	invalidate(): void {}
}

class Filler implements Component {
	render(): string[] {
		return Array.from({ length: 10 }, () => "reply");
	}
	invalidate(): void {}
}

/** The prompt's text is at transcript row 11. */
function bar(viewportTop: number): StickyPromptBar {
	const document = new Container();
	document.addChild(new Filler());
	document.addChild(new Prompt());
	document.render(80);
	const tui = { mode: "fullscreen", viewportTop, children: [document] } as never;
	const theme = {
		fg: (_token: string, text: string) => text,
		bg: (_token: string, text: string) => text,
	} as never;
	return new StickyPromptBar(tui, theme, (component) => component instanceof Prompt, () => true);
}

test("the bar is the text row then a blank row, with one column of padding on the left", () => {
	const lines = bar(20).render(80);
	assert.equal(lines.length, BAR_HEIGHT);
	assert.equal(BAR_HEIGHT, 2);
	assert.match(lines[0]!, /^ PROMPT-1: a fairly long prompt that will need truncating +$/);
	assert.equal(lines[1], " ".repeat(80));
	for (const line of lines) assert.equal(visibleWidth(line), 80);
});

test("truncated text keeps one column on each side and carries no escape codes", () => {
	// A reset inside the line would drop the bar background for the rest of the row.
	assert.equal(bar(20).render(30)[0], " PROMPT-1: a fairly long pro… ");
});

test("padding shrinks on very narrow widths so the text keeps a column", () => {
	for (const width of [3, 2, 1]) {
		const row = bar(20).render(width)[0]!;
		assert.equal(visibleWidth(row), width, `width ${width}`);
		assert.notEqual(row.trim(), "", `width ${width} shows some text`);
	}
});

test("a prompt is pinned once its first line slides under any bar row", () => {
	// Text row 11 is just below the bar at viewportTop 11 - BAR_HEIGHT, under its last row one line later.
	assert.deepEqual(bar(11 - BAR_HEIGHT).render(80), []);
	assert.equal(bar(12 - BAR_HEIGHT).render(80).length, BAR_HEIGHT);
});
