const state = { records: [], results: new Map(), running: false };
const $ = (selector) => document.querySelector(selector);

const samplePubMed = `PMID- 11111111
TI  - Risk factors for postoperative complications after radical gastrectomy for gastric cancer.
AB  - This cohort study evaluated human gastric cancer patients undergoing radical gastrectomy and identified predictors of postoperative complications.
DP  - 2024
JT  - Gastric Cancer
PT  - Journal Article
MH  - Stomach Neoplasms

PMID- 22222222
TI  - Chemotherapy for advanced gastric cancer: a review.
AB  - This review summarizes systemic chemotherapy for advanced gastric cancer.
DP  - 2022
JT  - Oncology Reviews
PT  - Review
MH  - Stomach Neoplasms`;

function log(message) {
  const time = new Date().toLocaleTimeString();
  $("#logBox").textContent += `[${time}] ${message}\n`;
  $("#logBox").scrollTop = $("#logBox").scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function getCriteria() {
  return {
    taskType: $("#taskType").value,
    question: $("#researchQuestion").value.trim(),
    include: $("#includeCriteria").value.trim(),
    exclude: $("#excludeCriteria").value.trim(),
    excludeReview: $("#excludeReview").checked,
    excludeAnimal: $("#excludeAnimal").checked
  };
}

function toAiRecord(record) {
  return {
    id: record.id,
    title: record.title,
    abstract: record.abstract,
    year: record.year,
    journal: record.journal,
    publicationType: record.publicationType,
    mesh: record.mesh,
    type: record.type
  };
}

function parseNbib(text) {
  return text.split(/\n\s*\n/).map((chunk, index) => {
    const fields = {};
    let key = null;
    for (const line of chunk.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9]{2,4})\s*-\s*(.*)$/);
      if (match) {
        key = match[1];
        fields[key] ||= [];
        fields[key].push(match[2].trim());
      } else if (key) {
        fields[key].push(line.trim());
      }
    }
    if (!Object.keys(fields).length) return null;
    return {
      id: fields.PMID?.[0] || `NBIB-${index + 1}`,
      title: (fields.TI || []).join(" "),
      abstract: (fields.AB || []).join(" "),
      year: (fields.DP?.[0] || "").match(/\d{4}/)?.[0] || "",
      journal: fields.JT?.[0] || fields.JA?.[0] || "",
      publicationType: (fields.PT || []).join("; "),
      mesh: (fields.MH || []).join("; "),
      type: "pubmed"
    };
  }).filter(Boolean);
}

function parseDelimited(text) {
  const first = text.split(/\r?\n/).find(Boolean) || "";
  const delimiter = first.includes("\t") ? "\t" : ",";
  const rows = parseRows(text, delimiter);
  if (!rows.length) return [];
  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).filter((row) => row.some(Boolean)).map((row, index) => {
    const object = {};
    headers.forEach((header, i) => object[header] = row[i] || "");
    const lower = Object.fromEntries(Object.entries(object).map(([key, value]) => [key.toLowerCase(), value]));
    const id = lower.pmid || lower.id || lower.gse || lower.gsm || lower.accession || `ROW-${index + 1}`;
    return {
      id,
      title: lower.title || lower.name || lower.series || lower.dataset || lower.sample_title || id,
      abstract: lower.abstract || lower.summary || lower.description || lower.characteristics || lower.metadata || Object.entries(object).map(([key, value]) => `${key}: ${value}`).join("; "),
      year: lower.year || lower.pubdate || lower.platform || lower.gpl || "",
      journal: lower.journal || lower.source || "",
      publicationType: lower.publication_type || lower.type || "",
      mesh: lower.mesh || "",
      type: $("#taskType").value
    };
  });
}

function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"" && quote && next === "\"") {
      cell += "\"";
      i++;
    } else if (char === "\"") {
      quote = !quote;
    } else if (char === delimiter && !quote) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quote) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseText(text) {
  if (/PMID\s*-/m.test(text)) return parseNbib(text);
  return parseDelimited(text);
}

function render() {
  const results = [...state.results.values()];
  $("#totalCount").textContent = state.records.length;
  $("#doneCount").textContent = results.length;
  $("#includeCount").textContent = results.filter((item) => item.decision === "纳入").length;
  $("#reviewCount").textContent = results.filter((item) => item.decision === "待复核").length;
  $("#excludeCount").textContent = results.filter((item) => item.decision === "排除").length;
  const percent = state.records.length ? Math.round(results.length / state.records.length * 100) : 0;
  $("#progressBar").style.width = `${percent}%`;
  $("#statusText").textContent = `已筛选 ${results.length}/${state.records.length} 条`;
  renderRecords();
  renderResults();
}

function renderRecords() {
  $("#recordsBody").innerHTML = state.records.slice(0, 300).map((record) => `
    <tr>
      <td>${escapeHtml(record.id)}</td>
      <td>${escapeHtml(record.title)}</td>
      <td>${escapeHtml(record.year || record.journal)}</td>
      <td>${escapeHtml((record.abstract || "").slice(0, 520))}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">尚未导入记录。</td></tr>`;
}

function renderResults() {
  const filter = $("#decisionFilter").value;
  const rows = state.records.map((record) => state.results.get(record.id) || {
    id: record.id,
    title: record.title,
    decision: "未筛选",
    score: "",
    reason: "",
    exclusionReason: "",
    matchedElements: ""
  }).filter((item) => filter === "all" || item.decision === filter);

  $("#resultsBody").innerHTML = rows.map((item) => `
    <tr>
      <td><span class="badge ${decisionClass(item.decision)}">${escapeHtml(item.decision)}</span></td>
      <td>${escapeHtml(item.score)}</td>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.reason)}</td>
      <td>${escapeHtml(item.exclusionReason)}</td>
      <td>${escapeHtml(Array.isArray(item.matchedElements) ? item.matchedElements.join("; ") : item.matchedElements)}</td>
    </tr>
  `).join("") || `<tr><td colspan="7">尚无筛选结果。</td></tr>`;
}

function decisionClass(decision) {
  return { "纳入": "include", "待复核": "review", "排除": "exclude", "未筛选": "pending" }[decision] || "pending";
}

async function apiPost(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

async function generateQuery() {
  try {
    log("正在用 DeepSeek 生成 PubMed 检索式...");
    const data = await apiPost("/api/query/generate", {
      question: $("#researchQuestion").value.trim(),
      include: $("#includeCriteria").value.trim(),
      exclude: $("#excludeCriteria").value.trim()
    });
    $("#pubmedQuery").value = data.query || "";
    if (data.inclusionDraft && !$("#includeCriteria").value.trim()) $("#includeCriteria").value = data.inclusionDraft;
    if (data.exclusionDraft && !$("#excludeCriteria").value.trim()) $("#excludeCriteria").value = data.exclusionDraft;
    log(`检索式生成完成。MeSH: ${(data.meshTerms || []).join("; ")}`);
  } catch (error) {
    log(`生成检索式失败：${error.message}`);
  }
}

async function fetchByPmids() {
  try {
    log("正在按 PMID 获取 PubMed 摘要...");
    const data = await apiPost("/api/pubmed/pmids", { pmids: $("#pmidInput").value });
    state.records = data.records || [];
    state.results.clear();
    log(`已获取 ${state.records.length} 条 PubMed 记录。`);
    render();
  } catch (error) {
    log(`获取 PMID 失败：${error.message}`);
  }
}

async function searchPubMed() {
  try {
    const query = $("#pubmedQuery").value.trim();
    if (!query) return log("请先填写或生成 PubMed 检索式。");
    log("正在搜索 PubMed 并获取摘要...");
    const data = await apiPost("/api/pubmed/search", {
      query,
      retmax: Number($("#retmax").value) || 200
    });
    state.records = data.records || [];
    state.results.clear();
    log(`PubMed 总命中 ${data.count} 条，已获取 ${state.records.length} 条。`);
    render();
  } catch (error) {
    log(`PubMed 搜索失败：${error.message}`);
  }
}

async function generateGeoQuery() {
  try {
    log("正在用 DeepSeek 生成 GEO 检索式...");
    const data = await apiPost("/api/geo/query/generate", {
      question: $("#researchQuestion").value.trim(),
      include: $("#includeCriteria").value.trim(),
      exclude: $("#excludeCriteria").value.trim()
    });
    $("#geoQuery").value = data.query || "";
    log(`GEO 检索式生成完成：${(data.concepts || []).join("; ")}`);
  } catch (error) {
    log(`生成 GEO 检索式失败：${error.message}`);
  }
}

async function searchGeo() {
  try {
    const query = $("#geoQuery").value.trim();
    if (!query) return log("请先填写或生成 GEO 检索式。");
    $("#taskType").value = "geo";
    log("正在搜索 NCBI GEO DataSets 并获取 metadata...");
    const data = await apiPost("/api/geo/search", {
      query,
      retmax: Number($("#geoRetmax").value) || 200
    });
    state.records = data.records || [];
    state.results.clear();
    log(`GEO 总命中 ${data.count} 条，已获取 ${state.records.length} 条 metadata。`);
    render();
  } catch (error) {
    log(`GEO 搜索失败：${error.message}`);
  }
}

async function testServer() {
  try {
    log("测试服务器与 DeepSeek 连接...");
    const data = await apiPost("/api/test");
    log(`测试成功：${data.response}`);
  } catch (error) {
    log(`测试失败：${error.message}`);
  }
}

async function screenRecords() {
  if (!state.records.length) return log("没有可筛选记录。");
  const batchSize = Math.max(1, Math.min(50, Number($("#batchSize").value) || 10));
  $("#screenButton").disabled = true;
  log(`开始筛选 ${state.records.length} 条，每批 ${batchSize} 条。`);
  try {
    for (let i = 0; i < state.records.length; i += batchSize) {
      const batch = state.records.slice(i, i + batchSize);
      log(`处理 ${i + 1}-${Math.min(i + batchSize, state.records.length)} 条`);
      const data = await apiPost("/api/screen", {
        criteria: getCriteria(),
        records: batch.map(toAiRecord)
      });
      for (const result of data.results) {
        const source = state.records.find((record) => record.id === result.id);
        state.results.set(result.id, { ...result, title: source?.title || "" });
      }
      render();
    }
    log("筛选完成。");
  } catch (error) {
    log(`筛选中断：${error.message}`);
  } finally {
    $("#screenButton").disabled = false;
    render();
  }
}

function exportRows() {
  return state.records.map((record) => {
    const result = state.results.get(record.id) || {};
    return {
      ID: record.id,
      标题或名称: record.title,
      年份或平台: record.year,
      期刊或来源: record.journal,
      类型: record.publicationType || record.type,
      GEO编号: record.accession || "",
      平台: record.platform || "",
      样本量: record.samples || "",
      物种: record.organism || "",
      摘要或描述: record.abstract,
      AI判断: result.decision || "未筛选",
      分数: result.score ?? "",
      理由: result.reason || "",
      排除原因: result.exclusionReason || "",
      匹配要素: Array.isArray(result.matchedElements) ? result.matchedElements.join("; ") : (result.matchedElements || ""),
      需人工复核: result.needsHumanReview ? "是" : "否"
    };
  });
}

function download(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportExcel() {
  const rows = exportRows();
  const headers = Object.keys(rows[0] || { ID: "" });
  const html = `<html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  download("ai-screening-results.xls", "application/vnd.ms-excel;charset=utf-8", html);
}

function exportPrisma() {
  const results = [...state.results.values()];
  const lines = [
    "PRISMA 初筛统计",
    `导入记录: ${state.records.length}`,
    `已筛选: ${results.length}`,
    `建议纳入: ${results.filter((item) => item.decision === "纳入").length}`,
    `待复核: ${results.filter((item) => item.decision === "待复核").length}`,
    `建议排除: ${results.filter((item) => item.decision === "排除").length}`
  ];
  download("prisma-screening-summary.txt", "text/plain;charset=utf-8", lines.join("\n"));
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === tab.dataset.tab));
  });
});

$("#parseButton").addEventListener("click", async () => {
  const file = $("#fileInput").files[0];
  if (!file) return log("请选择文件。");
  state.records = parseText(await file.text());
  state.results.clear();
  log(`解析完成：${state.records.length} 条记录。`);
  render();
});

$("#sampleButton").addEventListener("click", () => {
  $("#taskType").value = "pubmed";
  $("#researchQuestion").value = "胃癌根治术后并发症的危险因素";
  $("#includeCriteria").value = "人类胃癌患者；接受胃癌根治术或胃切除术；报告术后并发症、发病率或危险因素；原始研究";
  $("#excludeCriteria").value = "综述；病例报告；动物实验；非胃癌；非手术治疗；无术后结局";
  state.records = parseNbib(samplePubMed);
  state.results.clear();
  log("已载入示例记录。");
  render();
});

$("#testButton").addEventListener("click", testServer);
$("#generateQueryButton").addEventListener("click", generateQuery);
$("#fetchPmidsButton").addEventListener("click", fetchByPmids);
$("#searchPubMedButton").addEventListener("click", searchPubMed);
$("#generateGeoQueryButton").addEventListener("click", generateGeoQuery);
$("#searchGeoButton").addEventListener("click", searchGeo);
$("#screenButton").addEventListener("click", screenRecords);
$("#decisionFilter").addEventListener("change", renderResults);
$("#exportExcelButton").addEventListener("click", exportExcel);
$("#exportJsonButton").addEventListener("click", () => download("ai-screening-results.json", "application/json;charset=utf-8", JSON.stringify({ criteria: getCriteria(), records: state.records, results: [...state.results.values()] }, null, 2)));
$("#exportPrismaButton").addEventListener("click", exportPrisma);

render();
log("页面就绪。");
