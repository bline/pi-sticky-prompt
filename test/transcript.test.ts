import assert from "node:assert/strict";
import { test } from "node:test";
import { Container, type Component } from "@earendil-works/pi-tui";
import { collectPrompts, promptLineText, readTranscriptView, selectPinnedPrompt } from "../src/transcript.ts";

class Lines implements Component {
	private readonly lines: string[];
	constructor(lines: string[]) {
		this.lines = lines;
	}
	render(): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

class Prompt extends Lines {}

/** Wraps output in a border, so its rows are not the concatenation of its children. */
class Boxed extends Container {
	override render(width: number): string[] {
		return ["+--+", ...super.render(width), "+--+"];
	}
}

const isPrompt = (component: Component): boolean => component instanceof Prompt;

function transcript(): Container {
	const header = new Container();
	header.addChild(new Lines(["logo", ""]));
	const chat = new Container();
	chat.addChild(new Prompt(["", "\x1b[1mfirst\x1b[0m prompt", ""])); // rows 2-4, text at 3
	chat.addChild(new Lines(["answer", "answer", "answer"])); // rows 5-7
	const boxed = new Boxed();
	boxed.addChild(new Prompt(["hidden inside a non-plain container"]));
	chat.addChild(boxed); // rows 8-10, skipped
	chat.addChild(new Prompt(["", "second"])); // rows 11-12, text at 12
	const document = new Container();
	document.addChild(header);
	document.addChild(chat);
	document.render(40);
	return document;
}

test("collectPrompts finds each prompt's first non-blank row and its plain text", () => {
	assert.deepEqual(collectPrompts(transcript(), isPrompt), [
		{ row: 3, text: "first prompt" },
		{ row: 12, text: "second" },
	]);
});

/** Stand-in for pi-libtui's ComponentStack: renders children in order and records their spans. */
class SpanStack implements Component {
	private spans: { component: Component; index: number; row: number; height: number; width: number }[] = [];
	private readonly children: Component[];
	constructor(children: Component[]) {
		this.children = children;
	}
	render(width: number): string[] {
		const lines: string[] = [];
		this.spans = [];
		this.children.forEach((component, index) => {
			const rendered = component.render(width);
			this.spans.push({ component, index, row: lines.length, height: rendered.length, width });
			lines.push(...rendered);
		});
		return lines;
	}
	getSpans() {
		return this.spans.map((span) => ({ ...span }));
	}
	invalidate(): void {}
}

test("collectPrompts descends into span stacks, as mounted by pi-collapse-transcript", () => {
	const header = new Container();
	header.addChild(new Lines(["logo"]));
	const bubble = new Prompt([
		"\x1b]133;A\x07          ▄▄▄▄▄▄▄▄",
		"          █ hello █",
		"          █ world █",
		"          ▀▀▀▀▀▀▀▀",
	]);
	const section = new SpanStack([new Lines(["Worked for 3s · 2 steps"])]);
	const stack = new SpanStack([new Lines(["intro", ""]), bubble, section, new Prompt(["", "second"])]);
	const document = new Container();
	document.addChild(header); // row 0
	document.addChild(stack); // rows 1-9: intro 1-2, bubble 3-6, section 7, second 8-9
	document.render(40);
	assert.deepEqual(collectPrompts(document, isPrompt), [
		{ row: 4, text: "hello" },
		{ row: 9, text: "second" },
	]);
});

test("promptLineText drops escape codes, whitespace, and block-element framing", () => {
	assert.equal(promptLineText("   ▄▄▄▄   "), "");
	assert.equal(promptLineText("\x1b[44m  █ fix █ the █ bug  █\x1b[0m"), "fix █ the █ bug");
	assert.equal(promptLineText("\x1b[1mplain\x1b[0m prompt "), "plain prompt");
});

test("collectPrompts returns nothing before the document has rendered", () => {
	const document = new Container();
	document.addChild(new Prompt(["x"]));
	assert.deepEqual(collectPrompts(document, isPrompt), []);
});

test("selectPinnedPrompt pins the last prompt whose first line is under or above the bar", () => {
	const prompts = [
		{ row: 3, text: "a" },
		{ row: 12, text: "b" },
	];
	assert.equal(selectPinnedPrompt(prompts, 0, 1), undefined);
	assert.equal(selectPinnedPrompt(prompts, 2, 1), undefined); // "a" visible just below the bar
	assert.equal(selectPinnedPrompt(prompts, 3, 1)?.text, "a"); // "a" goes under the bar
	assert.equal(selectPinnedPrompt(prompts, 11, 1)?.text, "a"); // "b" visible just below the bar
	assert.equal(selectPinnedPrompt(prompts, 12, 1)?.text, "b");
	assert.equal(selectPinnedPrompt(prompts, 500, 1)?.text, "b");
});

test("readTranscriptView requires fullscreen, a numeric viewportTop and a rendered first child", () => {
	const document = transcript();
	const fake = (mode: string, viewportTop: unknown, children: Component[]) =>
		({ mode, viewportTop, children }) as never;
	assert.equal(readTranscriptView(fake("regular", 0, [document])), undefined);
	assert.equal(readTranscriptView(fake("fullscreen", undefined, [document])), undefined);
	assert.equal(readTranscriptView(fake("fullscreen", 0, [new Lines([])])), undefined);
	assert.equal(readTranscriptView(fake("fullscreen", 0, [new Container()])), undefined);
	const view = readTranscriptView(fake("fullscreen", 7, [document]));
	assert.equal(view?.scrollTop, 7);
	assert.equal(view?.document, document);
	// Unchanged content keeps the same key; changed content gets a new one.
	document.render(40);
	assert.equal(readTranscriptView(fake("fullscreen", 7, [document]))?.key, view?.key);
	document.addChild(new Lines(["more"]));
	document.render(40);
	assert.notEqual(readTranscriptView(fake("fullscreen", 7, [document]))?.key, view?.key);
});
