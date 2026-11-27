// End-to-end check in a real Pi TUI driven through tmux.
// Usage: node scripts/e2e.mjs <pi-binary> <label>
// Uses an isolated agent dir under .pi-test/<label>/ and the extension in this repository only (-ne -e).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [piBin, label] = process.argv.slice(2);
if (!piBin || !label) {
	console.error("usage: node scripts/e2e.mjs <pi-binary> <label>");
	process.exit(2);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(repo, ".pi-test", label);
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "agent"), { recursive: true });
execFileSync("node", [join(repo, "scripts/make-session.mjs"), join(work, "session.jsonl"), repo]);

// tmux reads "." and ":" in targets as window/pane separators.
// Extra extensions to load alongside this one, colon-separated, e.g. to test compatibility.
const extraExtensions = (process.env.PI_E2E_EXTENSIONS ?? "")
	.split(":")
	.filter(Boolean)
	.map((path) => `-e ${JSON.stringify(resolve(path))}`);
const tmuxSession = `sticky-e2e-${label.replace(/[.:]/g, "_")}-${process.pid}`;
const tmux = (...args) => execFileSync("tmux", args, { encoding: "utf8" });
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const capture = () => tmux("capture-pane", "-p", "-t", tmuxSession).split("\n");
const log = [];

async function waitFor(predicate, what, timeoutMs = 20000) {
	const end = Date.now() + timeoutMs;
	for (;;) {
		const screen = capture();
		if (predicate(screen)) return screen;
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n${screen.join("\n")}`);
		await delay(150);
	}
}

/** Capture after the screen stops changing. */
async function settle() {
	let previous = "";
	for (let i = 0; i < 40; i++) {
		await delay(120);
		const screen = capture();
		const text = screen.join("\n");
		if (text === previous) return screen;
		previous = text;
	}
	return capture();
}

// The bar covers BAR_ROWS rows with its text on TEXT_ROW (src/bar.ts BAR_HEIGHT).
const BAR_ROWS = 2;
const TEXT_ROW = 0;
const promptOn = (line) => /PROMPT-(\d)/.exec(line)?.[1];
const failures = [];

function check(step, screen, direction, state) {
	const pinned = promptOn(screen[TEXT_ROW]) ? Number(promptOn(screen[TEXT_ROW])) : 0;
	const visible = screen
		.slice(BAR_ROWS)
		.map((line, i) => ({ n: promptOn(line), row: i + BAR_ROWS }))
		.filter((p) => p.n)
		.map((p) => ({ n: Number(p.n), row: p.row }));
	const problems = [];
	if (visible.some((p) => p.n === pinned)) problems.push(`pinned PROMPT-${pinned} is also visible`);
	if (visible.length > 0 && pinned !== visible[0].n - 1)
		problems.push(`first visible prompt is PROMPT-${visible[0].n} at row ${visible[0].row}, expected bar PROMPT-${visible[0].n - 1}, got ${pinned}`);
	if (state.last !== undefined && (direction < 0 ? pinned > state.last : pinned < state.last))
		problems.push(`pinned moved against the scroll direction: ${state.last} -> ${pinned}`);
	state.last = pinned;
	log.push({ step, bar: screen[TEXT_ROW].trimEnd(), pinned, visible });
	for (const p of problems) failures.push(`${step}: ${p}\n${screen.join("\n")}`);
}

try {
	tmux("new-session", "-d", "-s", tmuxSession, "-x", "100", "-y", "30");
	tmux("set-option", "-t", tmuxSession, "remain-on-exit", "on");
	const command = [
		`PI_CODING_AGENT_DIR=${JSON.stringify(join(work, "agent"))}`,
		"PI_OFFLINE=1",
		JSON.stringify(piBin),
		"-ne",
		"-e",
		JSON.stringify(repo),
		...extraExtensions,
		"--offline",
		"--tui-mode fullscreen",
		"--session",
		JSON.stringify(join(work, "session.jsonl")),
	].join(" ");
	tmux("send-keys", "-t", tmuxSession, command, "Enter");
	await waitFor((s) => s.some((l) => l.includes("Reply 5, line 30.")), "transcript to load");
	let screen = await settle();
	writeFileSync(join(work, "start.txt"), screen.join("\n"));
	writeFileSync(join(work, "start-ansi.txt"), tmux("capture-pane", "-p", "-e", "-t", tmuxSession));
	const up = { last: undefined };
	check("bottom", screen, -1, up);

	// Page up to the top.
	for (let i = 1; i <= 12; i++) {
		tmux("send-keys", "-t", tmuxSession, "PPage");
		check(`pageUp#${i}`, await settle(), -1, up);
	}
	tmux("send-keys", "-t", tmuxSession, "C-Home");
	screen = await settle();
	check("top", screen, -1, up);
	if (screen.slice(0, BAR_ROWS).some(promptOn)) failures.push(`top: expected no bar at the top of the transcript\n${screen.join("\n")}`);

	// Wheel down one event at a time across the first prompt boundaries.
	const down = { last: undefined };
	for (let i = 1; i <= 90; i++) {
		tmux("send-keys", "-t", tmuxSession, "-l", "\x1b[<65;50;10M");
		check(`wheelDown#${i}`, await settle(), 1, down);
	}
	writeFileSync(join(work, "end.txt"), capture().join("\n"));
} catch (error) {
	failures.push(String(error?.stack ?? error));
} finally {
	try {
		tmux("kill-session", "-t", tmuxSession);
	} catch {}
}

writeFileSync(join(work, "steps.json"), JSON.stringify(log, null, 1));
const pinnedSeen = [...new Set(log.map((s) => s.pinned))];
console.log(JSON.stringify({ label, steps: log.length, pinnedSeen, failures: failures.length }));
for (const f of failures.slice(0, 3)) console.log(`FAIL ${f}\n`);
process.exit(failures.length === 0 ? 0 : 1);
