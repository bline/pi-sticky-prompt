import assert from "node:assert/strict";
import { test } from "node:test";
import { Container, type Component } from "@earendil-works/pi-tui";
import { collectPrompts, readTranscriptView, selectPinnedPrompt } from "../src/transcript.ts";

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
