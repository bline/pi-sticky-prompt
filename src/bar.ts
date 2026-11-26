import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { collectPrompts, readTranscriptView, selectPinnedPrompt, type PromptAnchor } from "./transcript.ts";

const PADDING_X = 1;
/** Transcript rows the bar covers; a prompt is pinned once its first line slides under any of them. */
export const BAR_HEIGHT = 2;

/**
 * Overlay anchored over the top transcript rows: the text row, then a blank row in the bar colour
 * that separates it from the transcript below. Pi composites overlays on every frame,
 * including scroll-only frames, so render() re-evaluates the pinned prompt on each scroll.
 */
export class StickyPromptBar implements Component {
	private promptsKey: object | undefined;
	private prompts: PromptAnchor[] = [];

	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly isPrompt: (component: Component) => boolean;
	/** Called during render; returning false renders nothing (the owner removes the overlay). */
	private readonly shouldShow: () => boolean;

	constructor(
		tui: TUI,
		theme: Theme,
		isPrompt: (component: Component) => boolean,
		shouldShow: () => boolean,
	) {
		this.tui = tui;
		this.theme = theme;
		this.isPrompt = isPrompt;
		this.shouldShow = shouldShow;
	}

	render(width: number): string[] {
		if (!this.shouldShow()) return [];
		const view = readTranscriptView(this.tui);
		if (!view) return [];
		if (view.key !== this.promptsKey) {
			this.promptsKey = view.key;
			this.prompts = collectPrompts(view.document, this.isPrompt);
		}
		const pinned = selectPinnedPrompt(this.prompts, view.scrollTop, BAR_HEIGHT);
		if (!pinned) return [];
		const padding = Math.max(0, Math.min(PADDING_X, Math.floor((width - 1) / 2)));
		// Truncation inserts SGR resets that would clear the bar background; the prompt text is plain.
		const truncated = stripTerminalSequences(truncateToWidth(pinned.text, width - 2 * padding, "…"));
		const text = " ".repeat(padding) + truncated;
		const padded = text + " ".repeat(Math.max(0, width - visibleWidth(text)));
		const row = this.theme.bg("userMessageBg", this.theme.fg("userMessageText", padded));
		return [row, this.theme.bg("userMessageBg", " ".repeat(width))];
	}

	invalidate(): void {
		this.promptsKey = undefined;
		this.prompts = [];
	}
}
