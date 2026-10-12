# ScratchAI（BlockAI 編輯器）

以 [TurboWarp](https://turbowarp.org/) 的 scratch-gui 為基礎修改的積木程式編輯器，加入以下功能：

1. 用提示詞讓 AI 產生積木（含角色、造型、變數、廣播），並自動排列
2. AI 自動批改（自由輸入標準或使用範本，支援批次批改、批次修改與報告匯出）
3. 可選擇各家模型 API，由使用者自行輸入 KEY；額度用完時自動降級到較低階模型
4. 支援官方與第三方擴充，載入後 AI 也能使用新積木
5. AI 生圖（Agnes AI），並提供去背等 Scratch 常用的後製選項

- 規格：[docs/SPEC.md](docs/SPEC.md)
- 與 TurboWarp 上游同步：[docs/UPSTREAM.md](docs/UPSTREAM.md)

## 開發

需要 Node.js 22 以上。

```bash
npm ci        # 安裝相依套件（會下載 micro:bit 韌體）
npm start     # 開發伺服器 http://localhost:8601/
npm run build # 建置到 build/
npm run test:unit
```

推送到 `main` 後，GitHub Actions 會自動建置並部署到 GitHub Pages（`.github/workflows/pages.yml`）。
第一次使用前，請到 repo 的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。

## 授權

本專案是 TurboWarp scratch-gui 的衍生作品，以 **GNU General Public License v3.0** 授權，詳見 [LICENSE](LICENSE)。
TurboWarp 原始 README（含 scratch-gui 必須保留的 BSD 授權聲明）收錄在 [docs/TURBOWARP_README.md](docs/TURBOWARP_README.md)。

Scratch 的名稱、Logo 與角色圖像是 MIT 的商標（見 [TRADEMARK](TRADEMARK)），本專案不代表、也未經 Scratch 團隊認可。
