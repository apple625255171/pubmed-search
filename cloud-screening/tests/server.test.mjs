import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 9188;
let child;

test("server serves health and index", async (t) => {
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), DEEPSEEK_API_KEY: "" },
    stdio: "ignore"
  });
  t.after(() => child?.kill());
  await waitForServer();

  const health = await fetch(`http://localhost:${port}/health`).then((res) => res.json());
  assert.equal(health.ok, true);
  assert.equal(health.apiConfigured, false);

  const html = await fetch(`http://localhost:${port}/`).then((res) => res.text());
  assert.match(html, /AI 批量筛选流水线/);
});

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("server did not start");
}
