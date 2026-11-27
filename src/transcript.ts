import { Container, stripTerminalSequences, type Component, type TUI } from "@earendil-works/pi-tui";

/** A user prompt in the fullscreen transcript, located by its first non-blank rendered row. */
export interface PromptAnchor {
	/** Transcript content row of the prompt's first non-blank line. */
	row: number;
	/** Plain text of that line. */
	text: string;
}

/** What the sticky bar needs from one frame of the fullscreen transcript. */
export interface TranscriptView {
	/** Identity of the transcript's rendered child layout; changes whenever transcript content changes. */
	key: object;
	/** Transcript document whose rendered rows the transcript ScrollView scrolls. */
	document: Container;
	/** First transcript content row visible at the top of the screen. */
	scrollTop: number;
}

/**
 * Pi-internal shapes read at runtime. They are not part of Pi's typed extension API, so every
 * read is checked and a mismatch yields "no sticky bar" instead of an error.
 *
 * - `TuiAltScreen.viewportTop` (public getter, not on the `TUI` interface): transcript scroll offset.
 * - `tui.children[0]`: Pi mounts its transcript document first (`documentContainer`).
 * - `Container.childLines` (TS-private): the children and per-child rendered lines from the last render.
 */
interface ChildLinesLike {
	readonly children: readonly Component[];
	readonly parts: readonly (readonly string[])[];
}

function childLinesOf(container: Container): ChildLinesLike | undefined {
	const value = (container as unknown as { childLines?: unknown }).childLines;
	if (!value || typeof value !== "object") return undefined;
	const { children, parts } = value as Partial<ChildLinesLike>;
	if (!Array.isArray(children) || !Array.isArray(parts) || children.length !== parts.length) return undefined;
	return value as ChildLinesLike;
}

/** Read the fullscreen transcript state, or undefined outside fullscreen or if Pi's layout changed shape. */
export function readTranscriptView(tui: TUI): TranscriptView | undefined {
	if (tui.mode !== "fullscreen") return undefined;
	const scrollTop = (tui as unknown as { viewportTop?: unknown }).viewportTop;
	if (typeof scrollTop !== "number" || !Number.isFinite(scrollTop)) return undefined;
	const document = tui.children[0];
	if (!(document instanceof Container)) return undefined;
	const key = childLinesOf(document);
	if (!key) return undefined;
	return { key, document, scrollTop };
}

/** True when the container renders as the plain concatenation of its children, so row offsets add up. */
function isPlainContainer(component: Component): component is Container {
	return component instanceof Container && component.render === Container.prototype.render;
}

/**
 * Geometry a stacking component records for each visible child after rendering. Matches
 * `ComponentStack.getSpans()` from `@luan.sh/pi-libtui`, which `pi-collapse-transcript` mounts in
 * place of Pi's chat container. Read by shape, so that package is not a dependency.
 */
interface SpanLike {
	readonly component: Component;
	readonly row: number;
	readonly height: number;
	readonly width: number;
}

function spansOf(component: Component): readonly SpanLike[] | undefined {
	const getSpans = (component as { getSpans?: unknown }).getSpans;
	if (typeof getSpans !== "function") return undefined;
	const spans: unknown = getSpans.call(component);
	if (!Array.isArray(spans)) return undefined;
	const valid = spans.every(
		(span: Partial<SpanLike> | null) =>
			!!span &&
			typeof span.component?.render === "function" &&
			typeof span.row === "number" &&
			typeof span.height === "number" &&
			typeof span.width === "number",
	);
	return valid ? (spans as SpanLike[]) : undefined;
}

/** Block elements (▀▄█ and others) that frame prompts, such as pi-libtui's message bubbles. */
const EDGE = /^[\s\u2580-\u259f]+|[\s\u2580-\u259f]+$/gu;

/** Plain prompt text of one rendered row, without escape codes or framing; empty for frame rows. */
export function promptLineText(line: string): string {
	return stripTerminalSequences(line).replace(EDGE, "");
}

/**
 * Find prompt rows in the last rendered layout of `document`, in transcript order.
 * Descends into plain containers, whose output is the concatenation of their children, and into
 * components that report child spans.
 */
export function collectPrompts(document: Container, isPrompt: (component: Component) => boolean): PromptAnchor[] {
	const prompts: PromptAnchor[] = [];
	const child = (component: Component, row: number, lines: () => readonly string[]): void => {
		if (!isPrompt(component)) {
			visit(component, row);
			return;
		}
		const rendered = lines();
		for (let offset = 0; offset < rendered.length; offset++) {
			const text = promptLineText(rendered[offset]!);
			if (text) {
				prompts.push({ row: row + offset, text });
				return;
			}
		}
	};
	const visit = (component: Component, base: number): void => {
		if (isPlainContainer(component)) {
			const layout = childLinesOf(component);
			if (!layout) return;
			let row = base;
			for (let index = 0; index < layout.children.length; index++) {
				const lines = layout.parts[index]!;
				child(layout.children[index]!, row, () => lines);
				row += lines.length;
			}
			return;
		}
		for (const span of spansOf(component) ?? []) {
			// Spans hold no lines; prompt components return their cached render for the same width.
			child(span.component, base + span.row, () => span.component.render(span.width).slice(0, span.height));
		}
	};
	visit(document, 0);
	return prompts;
}

/**
 * The prompt to pin: the last one whose first line is hidden above or under the bar.
 * A prompt whose first line is visible just below the bar leaves the previous prompt pinned.
 */
export function selectPinnedPrompt(
	prompts: readonly PromptAnchor[],
	scrollTop: number,
	barHeight: number,
): PromptAnchor | undefined {
	const limit = scrollTop + barHeight;
	let pinned: PromptAnchor | undefined;
	for (const prompt of prompts) {
		if (prompt.row >= limit) break;
		pinned = prompt;
	}
	return pinned;
}
