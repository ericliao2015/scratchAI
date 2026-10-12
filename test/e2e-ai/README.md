# AI 面板瀏覽器測試

用 Playwright 開啟建置好的編輯器，AI 服務（Anthropic、Agnes）都以 `page.route()` 模擬，不會產生費用。

| 檔案 | 測試內容 |
|---|---|
| `generate.js` | 設定 KEY → 產生接蘋果遊戲 → 套用 → 執行 |
| `more.js` | AI 生圖與後製、自我檢查與積木標示、老師模式、範本、批次批改與報告下載 |
| `ext.js` | 官方擴充（畫筆）與網址載入的第三方擴充出現在積木清單，並能產生積木 |
| `classroom.js` | 批次修改（統一修改）與下載、匯出班級設定檔、學生匯入後的考試模式與 PIN 保護 |

```bash
npm i --no-save playwright
NODE_ENV=production ROOT=/scratchAI/ npm run build
mkdir -p /tmp/serve && ln -sfn "$PWD/build" /tmp/serve/scratchAI
(cd /tmp/serve && python3 -m http.server 8765 &)
OUT=/tmp node test/e2e-ai/generate.js
```

截圖會存到 `OUT`。離線模式測試步驟：以 `ENABLE_SERVICE_WORKER=1` 建置，開啟一次編輯器等候快取完成，
停止網頁伺服器後重新整理，編輯器與 AI 面板仍可開啟。
