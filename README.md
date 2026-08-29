# 每日简报

每天北京时间 **07:30**，自动抓取新闻 → DeepSeek 精选 **5 条**最值得关注的内容 → 通过浏览器推送（Web Push）送达你的手机/电脑，并在网站页面展示。

- **主题**：AI / Agent / 大模型、科技产品与硬件、大学 / 专业 / 就业
- **每条包含**：简洁标题、2–4 句摘要、为什么值得关注/潜在影响、一张相关图片、来源链接；多来源有分歧时附简要说明
- **去重**：自动记录最近 30 天已报道内容，避免重复
- **免费**：GitHub Pages + GitHub Actions 免费额度 + DeepSeek API（每天成本约几分钱）

## 工作原理

```
GitHub Actions（每天 23:30 UTC = 07:30 北京时间）
  │ 1. 抓取：精选 RSS 源 + Bing News RSS（免费、无需 Key）
  │ 2. DeepSeek：过滤"昨天"→ 去重 → 按重要性选 5 条 → 写标题/摘要/观点/分歧说明
  │ 3. 补图：从原文抓 og:image（失败则前端自动降级为占位图）
  │ 4. 写入 docs/digests/YYYY-MM-DD.json 等，git 自动提交
  │ 5. Web Push 推送给 docs/subscriptions.json 里所有订阅设备
  ▼
GitHub Pages 静态站点（PWA）
  ▼
iPhone Safari（添加到主屏幕）/ 电脑 Chrome —— 接收推送，点击打开当日简报
```

## 一次性部署（约 15 分钟）

### 0. 前置条件

- 一个 GitHub 账号（免费即可；Pages 需要**公开仓库**）
- DeepSeek API Key：[platform.deepseek.com](https://platform.deepseek.com) 注册 → 充值（≥ ¥10 够用很久）→ API Keys 创建
- 手机：iPhone（iOS 16.4+）或 Android（Chrome/Edge）

### 1. 创建仓库并推送

```bash
# 在本项目根目录执行
git init
git add -A
git commit -m "init: 每日简报"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> 仓库名会决定网站地址：`https://<用户名>.github.io/<仓库名>/`。

### 2. 修改 docs/config.json

```json
{
  "repo": {
    "owner": "你的GitHub用户名",
    "name": "你的仓库名"
  }
}
```
`vapid.publicKey` 已生成并填好，一般无需改动（如自行重新生成，见第 4 步）。改完后提交推送。

### 3. 添加 Secret（仓库 Settings → Secrets and variables → Actions）

| Secret 名称 | 值 |
|---|---|
| `DEEPSEEK_API_KEY` | 你在 platform.deepseek.com 创建的 Key |
| `VAPID_PRIVATE_KEY` | 见下方说明 |
| `VAPID_SUBJECT` | `mailto:你的邮箱`（如 `mailto:you@example.com`） |

`VAPID_PRIVATE_KEY`：项目里已为你生成好密钥对，私钥在 `scripts/gen-vapid.mjs` 运行时才会输出。若你手头没有，本地运行一次即可拿到：

```bash
node scripts/gen-vapid.mjs   # 输出 publicKey / privateKey，私钥填入上面的 Secret
```
> 也可以使用官方命令生成：`npx web-push generate-vapid-keys`，效果等价。公钥填回 `docs/config.json` 的 `vapid.publicKey`。

### 4. 开启 GitHub Pages

仓库 Settings → Pages → **Build and deployment** → Source 选 **Deploy from a branch** → Branch 选 `main`、目录选 `/docs` → Save。

等 1–2 分钟，打开 `https://<用户名>.github.io/<仓库名>/` 确认页面可访问。

### 5. 手动跑一次，验证生成

仓库 Actions 页 → 左侧 **Daily Digest** → 右上 **Run workflow** → 等 1–3 分钟。

完成后检查：
- Actions 日志显示 `[digest] 完成` 且 `selected: 5`；
- 仓库里出现 `docs/digests/当天日期.json` 与更新的 `docs/latest.json`；
- 打开网站能看到 5 张卡片。

> 之后每天 07:30（北京时间）自动执行，无需任何操作。也可以在 Actions 页手动重跑。

### 6. 手机开启推送（iPhone 示例）

1. Safari 打开网站 → 分享按钮 → **添加到主屏幕**（iOS 16.4+ 才有推送能力）；
2. 从主屏幕图标打开 PWA（必须这样打开一次）；
3. 点右上 **⚙︎ 设置**：
   - 仓库 Owner / 名称：确认与第 2 步一致；
   - **GitHub 令牌**：创建一个 **fine-grained PAT**（GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens）：
     - Repository access：仅选中你的仓库；
     - Permissions → Contents → **Read and write**；
     - 生成后把令牌粘贴进来（只保存在这台手机浏览器里）；
   - 点 **测试连接**，显示成功即可；
4. 点 **开启推送**，允许通知 → 显示"已开启推送"。

> Android 手机用 Chrome/Edge 打开网站，点"开启推送"即可（无需添加到主屏幕也能推送）。

### 7. 电脑也收推送（可选）

电脑 Chrome 打开同一网址，同样点"开启推送"。浏览器保持开启即可在 07:30 收到通知（无需网页常驻前台）。

## 本地试运行

需要网络与 `DEEPSEEK_API_KEY`（在你的电脑上执行，会真实抓取并调用 API，但**不会**提交、不会推送）：

```bash
npm install
$env:DEEPSEEK_API_KEY="sk-..."   # PowerShell；Mac/Linux 用 export
node scripts/digest.mjs --dry-run
```

检查 `docs/digests/` 下生成的 JSON 质量即可。纯离线自测（不联网，用内置样例）：

```bash
node scripts/digest.mjs --offline
```

## 自定义

| 想改什么 | 改哪里 |
|---|---|
| 新闻源 / 搜索词 | `scripts/lib/feeds.mjs` 里的 `CURATED_FEEDS` 与 `BING_QUERIES` |
| 模型（可换 deepseek-reasoner） | 仓库 Secret `LLM_MODEL`（可选） |
| 每天条数（默认 5） | `scripts/lib/llm.mjs` 中 prompt 与 `selectTop5` 的 5 |
| 主题标签 | `docs/config.json` 的 `topicLabels`（同步改 feeds 的 topic 下标说明） |
| 推送时间 | `.github/workflows/digest.yml` 的 cron（注意 Actions cron 为 UTC：北京时间 = UTC+8） |
| 页面样式 | `docs/styles.css` |

## 故障排查

| 现象 | 处理 |
|---|---|
| Actions 报错 / 没生成 | 看 Actions 日志；首次先确认 3 个 Secret 已添加；`[llm]` 报错多为 Key 无效或余额不足 |
| 推送未收到 | ① 手机是否已"添加到主屏幕"且用 PWA 打开过；② 设置里测试连接是否成功；③ 通知权限是否允许；④ 私钥 `VAPID_PRIVATE_KEY` 与 `config.json` 公钥是否配对 |
| 提示"密钥格式错误" | 用 `npx web-push generate-vapid-keys` 重新生成，公钥写回 config.json，私钥更新 Secret |
| 某天新闻很少/为空 | 属正常：候选不足时条目会少于 5 条或显示占位说明 |
| 图片不显示 | 部分站点禁止外链，前端会自动换代理或渐变占位卡 |
| 国内访问 Pages 不稳定 | 可选：绑定自定义域名并套 Cloudflare 免费 CDN |

## 目录结构

```
.github/workflows/digest.yml   定时任务（每天 07:30 北京时间）
scripts/
  digest.mjs                   主流水线
  dry-run.mjs                  本机试运行入口
  gen-vapid.mjs                生成 VAPID 密钥
  gen-icons.mjs                生成 PWA 图标
  lib/                         feeds / llm / push / git / json / vapid
  sample-data.mjs              离线自测样例
docs/                           GitHub Pages 站点（PWA，发布源为 /docs）
  index.html / styles.css / app.js / sw.js / manifest.webmanifest / config.json
  icons/                       图标
  digests/                     每日简报数据（自动生成）
  latest.json / history.json / subscriptions.json   （自动维护）
```

## 安全说明

- 网站静态包中不含任何密钥；`vapid.publicKey` 是公开的（本应公开）。
- 手机上的 GitHub 令牌只存在该设备浏览器的 localStorage，用于把订阅写回仓库；请用**仅限本仓库 Contents 读+写**的 fine-grained PAT，并可在不需要时吊销。
- `DEEPSEEK_API_KEY`、`VAPID_PRIVATE_KEY` 只存在 GitHub Secrets，不进代码库。
