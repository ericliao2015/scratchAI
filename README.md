# ScratchAI（BlockAI 編輯器）

以 [TurboWarp](https://turbowarp.org/) 的 scratch-gui 為基礎修改的積木程式編輯器，加入以下功能：

1. 用提示詞讓 AI 產生積木（含角色、造型、變數、廣播），並自動排列
2. AI 自動批改（自由輸入標準或使用範本，支援批次批改、批次修改與報告匯出）
3. 可選擇各家模型 API，由使用者自行輸入 KEY；額度用完時自動降級到較低階模型
4. 支援官方與第三方擴充，載入後 AI 也能使用新積木
5. AI 生圖（Agnes AI），並提供去背等 Scratch 常用的後製選項

- **使用說明（老師／學生）：[docs/USAGE.md](docs/USAGE.md)**
- 規格：[docs/SPEC.md](docs/SPEC.md)
- 與 TurboWarp 上游同步：[docs/UPSTREAM.md](docs/UPSTREAM.md)
- 選用的代理伺服器：[proxy/README.md](proxy/README.md)

## 程式架構

| 位置 | 內容 |
|---|---|
| `src/ai/providers/` | 各家模型 API、錯誤分類、模型分級（`model-tiers.json`）與自動降級 |
| `src/ai/catalog/` | 從工具箱即時建立「AI 可用的積木清單」（含擴充） |
| `src/ai/ir/` | AI 輸出的中介格式（IR）編譯器與驗證 |
| `src/ai/apply/` | 把編譯結果套用到 VM、修改既有積木（patch ops）、造型 |
| `src/ai/project/` | 專案模型與「給 AI 看的文字版」 |
| `src/ai/grade/` | 規則檢查、AI 批改、範本、報告 |
| `src/ai/image/` | Agnes AI 生圖與後製（去背、裁切…） |
| `src/ai/batch.js` | 批次批改與批次修改 |
| `src/components/ai-panel/`、`src/containers/ai-panel-host.jsx` | AI 助手面板 |

## 開發

需要 Node.js 22 以上。

```bash
npm ci        # 安裝相依套件（會下載 micro:bit 韌體）
npm start     # 開發伺服器 http://localhost:8601/
npm run build # 建置到 build/
npm run test:unit
npx eslint src/ai src/components/ai-panel src/containers/ai-panel-host.jsx
```

瀏覽器端到端測試見 [test/e2e-ai/README.md](test/e2e-ai/README.md)。

> 在無法連到 `packagerdata.turbowarp.org` 的環境，`npm ci` 的 prepublish 會失敗，
> 可改用 `npm ci --ignore-scripts`，並建立 `src/generated/microbit-hex-url.cjs`（見 `scripts/prepublish.mjs`）。

推送到 `main` 後，GitHub Actions 會自動建置並部署到 GitHub Pages（`.github/workflows/pages.yml`）。
第一次使用前，請到 repo 的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。

## 授權

本專案是 TurboWarp scratch-gui 的衍生作品，以 **GNU General Public License v3.0** 授權，詳見 [LICENSE](LICENSE)。
TurboWarp 原始 README（含 scratch-gui 必須保留的 BSD 授權聲明）收錄在 [docs/TURBOWARP_README.md](docs/TURBOWARP_README.md)。

Scratch 的名稱、Logo 與角色圖像是 MIT 的商標（見 [TRADEMARK](TRADEMARK)），本專案不代表、也未經 Scratch 團隊認可。
