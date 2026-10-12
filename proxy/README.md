# 選用：代理伺服器（Cloudflare Worker）

大部分情況**不需要**代理：每位使用者在「設定」填自己的 KEY，瀏覽器直接呼叫 AI 服務。

以下情況才需要：

1. **生圖服務不允許瀏覽器直接呼叫（CORS）**：Agnes AI 若在「測試生圖」出現「無法連線」，請架設代理。
2. **老師想提供共用 KEY**：KEY 只放在代理上，學生電腦看不到；可設定每人每天的次數上限。

## 架設步驟

1. 註冊 Cloudflare（免費方案即可），建立一個 Worker，把 `cloudflare-worker.js` 的內容貼上並部署。
2. 在 Worker 的 Settings → Variables 設定：
   - `ALLOWED_ORIGIN`：你的網站網址，例如 `https://ericliao2015.github.io`
   - `AGNES_KEY`、`OPENAI_KEY`（選填）：共用的 KEY
   - `DAILY_LIMIT`（選填）：每個 IP 每天最多幾次，需要再綁定一個名為 `LIMITS` 的 KV namespace
3. 在 BlockAI 的「設定」：
   - 生圖「服務網址」填 `https://你的worker網址/agnes/v1`，KEY 可以留任意文字（使用共用 KEY 時）
   - 文字模型選「OpenAI 相容」，伺服器網址填 `https://你的worker網址/openai/v1`
4. 老師可以把這些設定寫進班級設定檔的說明，讓學生照著填。
