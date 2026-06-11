import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 8080);
const apiUrl = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";
const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://localhost:${port}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, model, apiConfigured: Boolean(process.env.DEEPSEEK_API_KEY) });
    }

    if (request.method === "POST" && url.pathname === "/api/screen") {
      return handleScreen(request, response);
    }

    if (request.method === "POST" && url.pathname === "/api/test") {
      return handleTest(response);
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(publicRoot, requested));
    if (!filePath.startsWith(publicRoot)) return text(response, 403, "Forbidden");
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch (error) {
    json(response, 500, { error: error.message || String(error) });
  }
}).listen(port, () => {
  console.log(`Screening pipeline running on http://localhost:${port}`);
});

async function handleTest(response) {
  const data = await callDeepSeek([
    { role: "system", content: "只输出 JSON。" },
    { role: "user", content: "输出 {\"ok\":true,\"message\":\"connected\"}" }
  ]);
  json(response, 200, { ok: true, response: data.choices?.[0]?.message?.content || "" });
}

async function handleScreen(request, response) {
  const { records = [], criteria = {} } = await readJson(request);
  if (!Array.isArray(records) || records.length === 0) return json(response, 400, { error: "records 不能为空" });
  if (records.length > 50) return json(response, 400, { error: "单批最多 50 条，请在前端分批发送" });

  const messages = buildMessages(records, criteria);
  const data = await callDeepSeek(messages);
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = parseModelJson(content);
  const results = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(results)) return json(response, 502, { error: "模型没有返回 results 数组", raw: content });
  json(response, 200, { results: results.map(normalizeResult) });
}

function buildMessages(records, criteria) {
  const taskType = criteria.taskType === "geo" ? "GEO 数据集/样本" : "PubMed 文献";
  return [
    {
      role: "system",
      content: "你是严格的医学系统综述和生信公共数据筛选助手。只输出 JSON，不要输出 markdown。信息不足时标为待复核。"
    },
    {
      role: "user",
      content: `任务：筛选${taskType}。\n研究问题：${criteria.question || ""}\n纳入标准：${criteria.include || ""}\n排除标准：${criteria.exclude || ""}\n额外规则：${criteria.excludeReview ? "排除综述；" : ""}${criteria.excludeAnimal ? "排除动物实验；" : ""}\n\n输出 JSON 对象：{"results":[...]}。每个对象字段：id, decision, score, reason, exclusionReason, matchedElements, needsHumanReview。\ndecision 只能是：纳入、排除、待复核。score 为 0-100。\n\n记录：\n${JSON.stringify(records, null, 2)}`
    }
  ];
}

async function callDeepSeek(messages) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("服务器缺少 DEEPSEEK_API_KEY 环境变量");
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });
  if (!res.ok) throw new Error(`DeepSeek API 错误：${res.status} ${await res.text()}`);
  return res.json();
}

function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型返回无法解析为 JSON");
    return JSON.parse(match[0]);
  }
}

function normalizeResult(item) {
  const decision = String(item.decision || "").includes("纳入")
    ? "纳入"
    : String(item.decision || "").includes("排除")
      ? "排除"
      : "待复核";
  return {
    id: String(item.id || ""),
    decision,
    score: Math.max(0, Math.min(100, Number(item.score || 0))),
    reason: String(item.reason || ""),
    exclusionReason: String(item.exclusionReason || ""),
    matchedElements: Array.isArray(item.matchedElements) ? item.matchedElements : String(item.matchedElements || ""),
    needsHumanReview: Boolean(item.needsHumanReview || decision === "待复核")
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new Error("请求过大，单次最多 20MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function text(response, status, body) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}
