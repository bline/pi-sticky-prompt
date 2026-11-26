import { UserMessageComponent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsList, type Component, type TUI } from "@earendil-works/pi-tui";
import { StickyPromptBar } from "./src/bar.ts";

const isPrompt = (component: Component): boolean => component instanceof UserMessageComponent;

/**
 * Pi refuses to change TUI mode while any overlay exists, and the mode changes from the settings
 * list. The bar steps aside while a settings list has focus and returns after it closes.
 */
function settingsListFocused(tui: TUI): boolean {
	const focused = (tui as unknown as { getFocusedComponent?: () => Component | null }).getFocusedComponent?.();
	return focused instanceof SettingsList;
}

export default function stickyPrompt(pi: ExtensionAPI): void {
	let enabled = true;
	let ctx: ExtensionContext | undefined;
	/** Pi's stable reference to the current renderer, learned from the first overlay factory call. */
	let tui: TUI | undefined;
	let close: (() => void) | undefined;
	let opening = false;
	let stopInput: (() => void) | undefined;

	// Overlays change regular-mode rendering, so the bar exists only in fullscreen.
	const wanted = (): boolean =>
		enabled && ctx !== undefined && (tui === undefined || (tui.mode === "fullscreen" && !settingsListFocused(tui)));

	const sync = (): void => {
		if (wanted()) open();
		else close?.();
	};

	function open(): void {
		if (close || opening || !ctx) return;
		opening = true;
		let finish: (() => void) | undefined;
		ctx.ui
			.custom<void>(
				(renderer, theme, _keybindings, done) => {
					tui = renderer;
					let closed = false;
					finish = () => {
						if (closed) return;
						closed = true;
						done();
					};
					close = finish;
					opening = false;
					if (!wanted()) queueMicrotask(sync);
					return new StickyPromptBar(renderer, theme, isPrompt, () => {
						if (wanted()) return true;
						queueMicrotask(sync);
						return false;
					});
				},
				{ overlay: true, overlayOptions: { anchor: "top-left", width: "100%", nonCapturing: true } },
			)
			// Resolves when the bar closes, including when Pi removes extension overlays on session replacement.
			.then(
				() => {
					if (close === finish) close = undefined;
				},
				() => {
					if (close === finish) close = undefined;
					opening = false;
				},
			);
	}

	pi.on("session_start", (_event, startCtx) => {
		if (!startCtx.hasUI || startCtx.mode !== "tui") return;
		ctx = startCtx;
		stopInput?.();
		// Reopen after a key closes the settings list or otherwise makes the bar wanted again.
		stopInput = startCtx.ui.onTerminalInput(() => {
			if (!close) setTimeout(sync, 0);
			return undefined;
		});
		sync();
	});

	pi.on("session_shutdown", () => {
		stopInput?.();
		stopInput = undefined;
		ctx = undefined;
		close?.();
	});

	pi.registerCommand("sticky-prompt", {
		description: "Show or hide the sticky prompt bar: /sticky-prompt [on|off]",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			if (arg !== "" && arg !== "on" && arg !== "off") {
				commandCtx.ui.notify("Usage: /sticky-prompt [on|off]", "error");
				return;
			}
			enabled = arg === "" ? !enabled : arg === "on";
			sync();
			const note = enabled && tui !== undefined && tui.mode !== "fullscreen" ? " (shown in fullscreen mode only)" : "";
			commandCtx.ui.notify(`Sticky prompt ${enabled ? "on" : "off"}${note}`, "info");
		},
	});
}
