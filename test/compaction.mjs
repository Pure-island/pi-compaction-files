/** Full Pi RPC -> native compact -> local HTTP provider -> persisted summary.
 * No credentials, user sessions, or external model requests are used.
 * Set PI_CODING_AGENT_CLI to Pi's dist/cli.js if Pi is installed globally.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cli = process.env.PI_CODING_AGENT_CLI || join(dirname(require.resolve("@earendil-works/pi-coding-agent")), "cli.js");
const root = mkdtempSync(join(tmpdir(), "pi-compaction-"));
const requests = [];
const server = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	const payload = JSON.parse(body);
	requests.push({ url: req.url, authorization: req.headers.authorization, payload });
	const text = "## Goal\nKeep the task and its current decisions.\n\n" +
		`<modified-files>\n${root}/kept-a.ts\n${root}/kept-b.ts\n${root}/secret.txt\n${root}/deleted.ts\n</modified-files>`;
	res.writeHead(200, { "content-type": "text/event-stream" });
	const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
	res.write(chunk({ role: "assistant", content: text }, null));
	res.write(chunk({}, "stop"));
	res.end("data: [DONE]\n\n");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;

function provider(route, key, id, maxTokens) {
	return {
		baseUrl: `http://127.0.0.1:${port}/${route}/v1`,
		api: "openai-completions",
		apiKey: key,
		compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true, supportsStrictMode: false, maxTokensField: "max_tokens" },
		models: [{ id, name: id, reasoning: true, input: ["text"], contextWindow: 65536, maxTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
	};
}

async function runCase() {
	const name = "active";
	const cwd = join(root, name);
	const agent = join(cwd, "agent");
	mkdirSync(agent, { recursive: true });
	const configFile = join(cwd, "filelist.json");
	writeFileSync(configFile, JSON.stringify({ compactThinking: "low", keepModified: 1, keepRead: 1, sensitivePatterns: ["/secret"], excludePatterns: [], retryOnOverflow: false }));
	writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: {
		active: provider("active", "active-key", "conversation", 4000),
	} }));
	writeFileSync(join(agent, "settings.json"), JSON.stringify({ compaction: { enabled: true, reserveTokens: 4000, keepRecentTokens: 2000 }, retry: { enabled: false }, quietStartup: true }));
	const timestamp = new Date().toISOString();
	const messages = [];
	for (let i = 0; i < 8; i++) {
		messages.push({ type: "message", id: `m${i}`, parentId: i ? `m${i - 1}` : null, timestamp, message: {
			role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `turn ${i}: ${"task context ".repeat(400)}` }], timestamp: Date.now(),
			...(i % 2 ? { api: "openai-completions", provider: "active", model: "conversation", stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}),
		} });
	}
	const session = join(cwd, "fixture.jsonl");
	writeFileSync(session, [{ type: "session", version: 3, id: name, cwd, timestamp }, ...messages].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
	const start = requests.length;
	const child = spawn(process.execPath, [cli, "--mode", "rpc", "--provider", "active", "--model", "conversation", "--thinking", "off", "--session", session, "--no-extensions", "-e", pkg, "--no-mcp", "--no-skills", "--no-context-files", "--no-prompt-templates", "--offline", "--no-approve"], {
		cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_COMPACTION_FILES_CONFIG: configFile, PI_OFFLINE: "1" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.on("data", (data) => { stderr += data; });
	const lines = createInterface({ input: child.stdout });
	try {
		const result = await new Promise((accept, reject) => {
			const timer = setTimeout(() => reject(new Error(`${name}: timed out\n${stderr}`)), 30000);
			const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : accept(value); };
			child.once("error", (error) => finish(error, null));
			child.once("exit", (code) => finish(new Error(`${name}: Pi exited ${code}\n${stderr}`), null));
			lines.on("line", (line) => {
				let event;
				try { event = JSON.parse(line); } catch { return; }
				if (event.type === "response" && event.command === "compact") finish(null, event);
			});
			child.stdin.write(JSON.stringify({ type: "compact", customInstructions: "Keep the active task." }) + "\n");
		});
		assert.equal(result.success, true, `${name}: ${result.error}\n${stderr}`);
		const entries = readFileSync(session, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const saved = entries.filter((entry) => entry.type === "compaction").at(-1);
		assert(saved, `${name}: compaction must be persisted`);
		assert(saved.summary.includes("## Goal"));
		const sent = requests.slice(start);
		assert.equal(sent.length, 1, `${name}: no duplicate summary request`);
		const call = sent[0];
		assert.equal(call.payload.model, "conversation");
		assert.equal(call.authorization, "Bearer active-key");
		assert.equal(call.url, "/active/v1/chat/completions");
		assert.equal(call.payload.max_tokens, Math.floor(4000 * 0.9));
		assert.equal(call.payload.reasoning_effort, "low");
		assert.equal(saved.fromHook, true);
		assert.equal(saved.details.fileListIndex.keptModified, 1);
		assert.equal(saved.details.fileListIndex.outputCap, 4000);
		assert(!saved.summary.includes("secret.txt"));
		assert(!saved.summary.includes("deleted.ts"));
		assert(saved.summary.includes("kept-"), "existing Windows paths must survive filtering");
		assert.equal(saved.details.fileListIndex.blocksFound, 1);
		console.log(`PASS ${name}: ${sent.length} request(s), model=${call.payload.model}, fromHook=${!!saved.fromHook}`);
	} finally {
		lines.close();
		child.stdin.end();
		child.kill();
		if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
	}
}

try {
	for (const name of ["kept-a.ts", "kept-b.ts", "secret.txt"]) writeFileSync(join(root, name), "fixture");
	await runCase();
} finally {
	server.closeAllConnections();
	await new Promise((done) => server.close(done));
	rmSync(root, { recursive: true, force: true });
}
