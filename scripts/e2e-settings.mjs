// Checks that the sticky bar does not block switching TUI mode from /settings.
// Usage: node scripts/e2e-settings.mjs <pi-binary> <label> [keys-json]
// keys-json: tmux send-keys arguments sent after /settings opens, e.g. '[["tui"],["Enter"]]'.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [piBin, label, keysJson = "[]"] = process.argv.slice(2);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(repo, ".pi-test", label);
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "agent"), { recursive: true });
execFileSync("node", [join(repo, "scripts/make-session.mjs"), join(work, "session.jsonl"), repo]);

// Extra extensions to load as well, colon-separated, e.g. to test compatibility.
const extra = (process.env.PI_E2E_EXTENSIONS ?? "")
	.split(":")
	.filter(Boolean)
	.map((path) => ` -e ${JSON.stringify(resolve(path))}`)
	.join("");
const name = `sticky-settings-${label.replace(/[.:]/g, "_")}-${process.pid}`;
const tmux = (...args) => execFileSync("tmux", args, { encoding: "utf8" });
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const capture = () => tmux("capture-pane", "-p", "-t", name);
async function settle() {
	let previous = "";
	for (let i = 0; i < 40; i++) {
		await delay(150);
		const text = capture();
		if (text === previous) return text;
		previous = text;
	}
	return capture();
}
const shots = [];
const shot = async (title) => shots.push(`===== ${title}\n${await settle()}`);

try {
	tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30");
	tmux(
		"send-keys",
		"-t",
		name,
		`PI_CODING_AGENT_DIR=${JSON.stringify(join(work, "agent"))} PI_OFFLINE=1 ${JSON.stringify(piBin)} -ne -e ${JSON.stringify(repo)}${extra} --offline --tui-mode fullscreen --session ${JSON.stringify(join(work, "session.jsonl"))}`,
		"Enter",
	);
	for (let i = 0; i < 100 && !capture().includes("Reply 5, line 30."); i++) await delay(200);
	await shot("loaded");
	tmux("send-keys", "-t", name, "-l", "/settings");
	tmux("send-keys", "-t", name, "Enter");
	await shot("settings open");
	for (const keys of JSON.parse(keysJson)) {
		tmux("send-keys", "-t", name, ...keys);
		await shot(`after ${JSON.stringify(keys)}`);
	}
	tmux("send-keys", "-t", name, "Escape");
	await shot("after Escape");
	tmux("send-keys", "-t", name, "PPage");
	await shot("after PageUp");
} finally {
	try {
		tmux("kill-session", "-t", name);
	} catch {}
}
writeFileSync(join(work, "shots.txt"), shots.join("\n"));
console.log(join(work, "shots.txt"));
