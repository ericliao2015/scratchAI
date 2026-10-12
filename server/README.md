# BlockAI 班級閘道（Class gateway v2）

一個小型伺服器，替全班保管 AI KEY，並提供：

- **班級代碼**：學生在「設定 → 平台：班級閘道」輸入網址、班級代碼與座號即可使用 AI，不需要自己的 KEY。
- **額度**：每人每天的次數／token 上限、全班每天 token 上限；超過時回傳「額度用完」。
- **備援**：每個班級可以設定多個模型，依序嘗試（上一個額度用完或不能用時換下一個）。
- **用量統計**：老師在「班級」分頁看每位學生近 7 天的用量。
- **繳交作業**：學生在「自我檢查」按「繳交給老師」，老師在「班級」分頁下載或直接送到批次批改。
- **雲端專案**：學生可以把專案存到閘道、在別台電腦開啟。
- **名單（選填）**：設定 roster 後，只有名單上的座號／姓名可以使用。

同一份程式（`core/gateway.js`）可以跑在 Node 或 Cloudflare Workers。

## 方式一：學校電腦或任何 Node 22+ 主機

```bash
ADMIN_TOKEN=請換成很長的密碼 \
ANTHROPIC_KEY=sk-ant-... \
ALLOWED_ORIGINS=https://ericliao2015.github.io \
node server/node.js
```

| 環境變數 | 說明 |
| --- | --- |
| `ADMIN_TOKEN` | 老師管理密碼（「班級」分頁使用）。不設定就不能管理。 |
| `ANTHROPIC_KEY` / `OPENAI_KEY` / `GEMINI_KEY` | 上游 AI 服務的 KEY，有設定的平台才能用。 |
| `COMPATIBLE_URL` / `COMPATIBLE_KEY` | OpenAI 相容服務（例如校內的 Ollama：`http://127.0.0.1:11434/v1`）。 |
| `ALLOWED_ORIGINS` | 允許的網站，逗號分隔；`*` 表示全部。 |
| `PORT` | 預設 8787。 |
| `DATA_DIR` | 資料夾（預設 `./blockai-data`）；`:memory:` 表示不存檔。 |
| `MAX_PROJECT_MB` | 單一專案大小上限，預設 10。 |

對外提供時請放在 HTTPS 反向代理（例如 Caddy、nginx）後面：GitHub Pages 是 HTTPS，瀏覽器不允許它呼叫 http 的閘道（localhost 除外）。

## 方式二：Cloudflare Workers（免費方案即可）

```bash
cd server
npx wrangler kv namespace create BLOCKAI     # 把 id 填進 wrangler.toml
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ANTHROPIC_KEY        # 需要的平台都設定
npx wrangler deploy
```

`wrangler.toml` 的 `ALLOWED_ORIGINS` 改成你的網站網址。

## 使用流程

1. 老師：BlockAI 進入老師模式 → **班級** 分頁 → 填閘道網址與 ADMIN_TOKEN → 連線 → 新增班級（名稱、模型、額度）。
2. 老師：按 **放進班級設定檔**，到 **範本** 分頁匯出班級設定檔給學生（或直接告訴學生網址與班級代碼）。
3. 學生：套用班級設定（或在「設定」選平台「班級閘道」自己填），輸入座號即可使用。

## API 摘要

學生：`Authorization: Bearer <班級代碼>.<座號（URL 編碼）>`

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/v1/health` | 狀態 |
| GET | `/v1/whoami` | 學生身分與班級 |
| GET | `/v1/models` | 班級可用模型 |
| POST | `/v1/complete` | `{model?, system, messages, json, maxTokens}` → `{text, usage, model}` |
| GET | `/v1/usage` | 今日用量 |
| POST/GET | `/v1/submissions` | 繳交 `{assignment, fileName, project(base64), report, summary}`／自己的繳交清單 |
| GET/PUT/DELETE | `/v1/projects[/名稱]` | 雲端專案 |

老師：`Authorization: Bearer <ADMIN_TOKEN>`

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET/POST | `/v1/admin/classes` | 班級清單／新增 `{name, models: ["anthropic/claude-sonnet-5-5"], limits, roster}` |
| GET/PATCH/DELETE | `/v1/admin/classes/:code` | 讀取／修改（含 `active: false` 停用）／刪除 |
| GET | `/v1/admin/classes/:code/usage?days=7` | 用量 |
| GET | `/v1/admin/classes/:code/submissions[/:id]` | 繳交清單／下載 |

## 擴充

儲存只透過 `get/put/delete/list` 四個函式（`core/stores.js`、`core/file-store.js`），要換成資料庫只需實作同樣的介面。
編輯器端的對應介面在 `src/ai/backend/index.js`（`localBackend`、`gatewayBackend`），要接學校既有系統時新增一個 adapter 即可。
