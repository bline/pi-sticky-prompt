// Writes a synthetic session with several prompts and long replies, for manual and tmux testing.
// Usage: node scripts/make-session.mjs <out.jsonl> [cwd]
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [out, cwd = process.cwd()] = process.argv.slice(2);
if (!out) {
	console.error("usage: node scripts/make-session.mjs <out.jsonl> [cwd]");
	process.exit(2);
}

const start = Date.parse("2026-11-25T12:00:00.000Z");
const usage = {
	input: 10,
	output: 10,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 20,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const lines = [{ type: "session", version: 3, id: randomUUID(), timestamp: new Date(start).toISOString(), cwd }];
let parentId = null;
let tick = 0;
const add = (message) => {
	const id = (++tick).toString(16).padStart(8, "0");
	const time = start + tick * 1000;
	lines.push({ type: "message", id, parentId, timestamp: new Date(time).toISOString(), message: { ...message, timestamp: time } });
	parentId = id;
};

for (let n = 1; n <= 5; n++) {
	add({ role: "user", content: `PROMPT-${n}: question number ${n} about the sticky header` });
	const reply = Array.from({ length: 30 }, (_, i) => `Reply ${n}, line ${i + 1}.`).join("\n\n");
	add({
		role: "assistant",
		content: [{ type: "text", text: reply }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage,
		stopReason: "stop",
	});
}

writeFileSync(out, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
console.log(out);
