// Checks that drag-selecting past the top edge of the fullscreen transcript auto-scrolls it.
// Usage: node scripts/e2e-select.mjs <pi-binary> <label> [--without-extension]
// Prints JSON with the first transcript line before and after the drag; exits 1 when it did not scroll.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [piBin, label, flag] = process.argv.slice(2);
const withExtension = flag !== "--without-extension";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(repo, ".pi-test", label);
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "agent"), { recursive: true });
execFileSync("node", [join(repo, "scripts/make-session.mjs"), join(work, "session.jsonl"), repo]);

const name = `sticky-select-${label.replace(/[.:]/g, "_")}-${process.pid}`;
const tmux = (...args) => execFileSync("tmux", args, { encoding: "utf8" });
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const capture = () => tmux("capture-pane", "-p", "-t", name).split("\n");
const send = (bytes) => tmux("send-keys", "-t", name, "-l", bytes);
async function settle() {
	let previous = "";
	for (let i = 0; i < 40; i++) {
		await delay(120);
		const text = capture().join("\n");
		if (text === previous) return text.split("\n");
		previous = text;
	}
	return capture();
}
/** First "Reply n, line m." on screen, as a transcript position. */
function firstReply(screen) {
	for (const line of screen) {
		const match = /Reply (\d), line (\d+)\./.exec(line);
		if (match) return { text: match[0], position: Number(match[1]) * 100 + Number(match[2]) };
	}
	return undefined;
}

let result;
try {
	tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30");
	const extension = withExtension ? `-e ${JSON.stringify(repo)}` : "";
	tmux(
		"send-keys",
		"-t",
		name,
		`PI_CODING_AGENT_DIR=${JSON.stringify(join(work, "agent"))} PI_OFFLINE=1 ${JSON.stringify(piBin)} -ne ${extension} --offline --tui-mode fullscreen --session ${JSON.stringify(join(work, "session.jsonl"))}`,
		"Enter",
	);
	for (let i = 0; i < 100 && !capture().some((l) => l.includes("Reply 5, line 30.")); i++) await delay(200);
	// Scroll up a little so there is transcript above the viewport to auto-scroll into.
	tmux("send-keys", "-t", name, "PPage");
	const before = firstReply(await settle());
	// SGR mouse, 1-based: press at row 15, drag to row 1, hold, release at row 1.
	send("\x1b[<0;20;15M");
	await delay(100);
	for (const row of [12, 8, 4, 2, 1]) {
		send(`\x1b[<32;20;${row}M`);
		await delay(60);
	}
	await delay(1500);
	send("\x1b[<0;20;1m");
	const after = firstReply(await settle());
	result = { label, withExtension, before, after, scrolled: !!before && !!after && after.position < before.position };
	writeFileSync(join(work, "after.txt"), capture().join("\n"));
} finally {
	try {
		tmux("kill-session", "-t", name);
	} catch {}
}
console.log(JSON.stringify(result));
process.exit(result?.scrolled ? 0 : 1);
