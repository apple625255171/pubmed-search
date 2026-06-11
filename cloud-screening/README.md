# AI 批量文献与 GEO 数据集筛选流水线

这是手机可访问的云端版本：

- 前端：上传 PubMed / GEO 导出文件，填写纳排标准，查看结果并导出 Excel
- 后端：保存 DeepSeek API Key，代理调用 DeepSeek，不把 Key 暴露给浏览器

## 本地运行

无需安装额外软件，本机已有 Node.js 时直接运行：

```bash
cd cloud-screening
set DEEPSEEK_API_KEY=你的_key
npm start
```

然后访问：

```text
http://localhost:8080
```

## 云端部署需要准备什么

你需要：

- DeepSeek API Key：[https://platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
- 一个部署平台账号，推荐 Render 或 Railway
- 如果想长期维护，建议准备一个 GitHub 账号和仓库

不需要在手机上安装软件。部署成功后，手机直接打开网址即可。

## Render 部署思路

1. 把 `cloud-screening` 目录上传到 GitHub 仓库。
2. Render 新建 Web Service。
3. Build Command 留空或填 `npm install`。
4. Start Command 填：

```bash
npm start
```

5. Environment Variables 添加：

```text
DEEPSEEK_API_KEY=你的_key
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-v4-flash
```

6. 部署完成后，用 Render 给的网址在手机上打开。

## 支持的文件

- PubMed：`.nbib`、`.csv`、`.txt`
- GEO：包含 GSE/GSM metadata 的 `.csv`、`.tsv`、`.txt`

## 输出

- Excel 可打开的 `.xls`
- JSON 备份
- PRISMA 初筛统计
