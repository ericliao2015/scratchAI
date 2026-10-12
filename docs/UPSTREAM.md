# 與 TurboWarp 上游同步

本 repo 以「快照匯入」的方式納入 TurboWarp scratch-gui（不保留上游的 git 歷史，因為上游歷史含有大型檔案）。

| 項目 | 值 |
|---|---|
| 上游 | https://github.com/TurboWarp/scratch-gui |
| 分支 | `develop` |
| 目前同步到的 commit | `e9d3bde6633f67f52e2144e57a44dfacc807444b` |

## 同步步驟

```bash
scripts/sync-upstream.sh            # 套用上游從記錄的 commit 到 develop 最新版之間的變更
```

腳本會用 `git apply -3` 套用差異；有衝突時會留下衝突標記，手動解決後再 commit，並更新上表的 commit。

## 修改原則

- AI 相關程式碼集中在 `src/ai/` 與 `src/components/ai-*`、`src/containers/ai-*`。
- 修改 TurboWarp 原始檔案時，加上 `// scratchAI:` 註解，方便同步時辨識。
