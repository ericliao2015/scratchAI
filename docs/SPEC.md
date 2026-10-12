# ScratchAI 規格書（草案 v0.1）

> 以 TurboWarp 為基礎，加入「AI 產生積木」與「AI 自動批改」功能的 Scratch 編輯器。
> 本文件記錄需求決策與技術設計，後續開發以此為準，變更請同步更新。

---

## 1. 需求決策紀錄

| # | 議題 | 決策 |
|---|---|---|
| D1 | 使用者 | 學生與老師都會使用，以「模式」切換（見 §3） |
| D2 | 基底 | TurboWarp（scratch-gui / scratch-vm / scratch-blocks 的 TurboWarp 分支） |
| D3 | 產生範圍 | 角色、造型、變數、清單、廣播、自訂積木，及工具箱上出現的所有積木 |
| D4 | 批改 | 支援自由輸入標準與「批改範本」；支援批次批改多個檔案；結果可匯出成文字，每個檔案各有一份紀錄 |
| D5 | 外掛 | 官方擴充與使用者以網址／檔案載入的第三方擴充都要支援 |
| D6 | 部署 | 第一階段 GitHub Pages（純前端）；之後打包離線版 |
| D7 | 年齡層 | 國小到老師都適用，介面分「簡易」與「進階」 |
| D8 | 批次處理 | 批次**批改**與批次**修改**都要支援（見 §7.6） |
| D9 | 計分方式 | 每個範本可以選「分數」或「通過／不通過」 |
| D10 | 學生可見度 | 老師針對每個範本決定學生看到多少細節（見 §7.4） |
| D11 | KEY 來源 | 每位學生填自己的 KEY：先選平台 → 再選模型 → 填 KEY；額度用完時自動降級到較低階的模型（見 §4.4） |
| D12 | 生圖 | 接 Agnes AI 生圖 API，並提供去背等 Scratch 常用的後製選項（見 §6.4） |

### 授權與商標注意事項
- TurboWarp 的 scratch-gui 修改部分採 **GPL-3.0**，因此本專案衍生作品必須以 GPL-3.0 開源。
- 「Scratch」名稱、Logo、Scratch Cat 是 Scratch Foundation 的商標，產品名稱與圖示不可使用。

---

## 2. 系統架構

```
┌──────────────────────── TurboWarp scratch-gui（fork） ────────────────────────┐
│  既有編輯器 UI                     │  新增：AI 面板（React 元件）              │
│                                    │   ├─ 產生分頁（提示詞輸入／對話）         │
│                                    │   ├─ 批改分頁（單檔／批次）               │
│                                    │   └─ 設定（模型、KEY、模式）              │
└───────────────┬────────────────────┴──────────────┬───────────────────────────┘
                │ vm / workspace                     │
┌───────────────▼────────────────────────────────────▼──────────────────────────┐
│ src/ai/（與 GUI 解耦，可在 Node 單獨測試）                                      │
│  providers/   各家模型 API 抽象層                                               │
│  catalog/     動態積木清單（核心積木 + 已載入擴充）                             │
│  ir/          中介表示（IR）schema、驗證器                                       │
│  compiler/    IR → sb3 blocks / sprite3；sb3 → 可讀文字（反向）                  │
│  apply/       寫入 VM、快照與復原                                               │
│  grader/      規則檢查、AI 評分、批次處理、報告匯出                             │
│  config/      模式、班級設定檔                                                  │
└────────────────────────────────────────────────────────────────────────────────┘
```

原則：AI 相關程式碼集中在 `src/ai/` 與少數 GUI 掛載點，盡量減少修改 TurboWarp 原始檔案，方便日後合併上游更新（設定 `upstream` remote 定期 merge）。

---

## 3. 模式與角色切換（D1）

GitHub Pages 是純靜態網站，**沒有真正的帳號驗證**，以下機制只是「防君子」，不是資安防護。

| 模式 | 可用功能 |
|---|---|
| 學生模式（預設） | AI 產生積木、自我檢查（用老師提供的範本，看不到標準答案細節） |
| 老師模式 | 上述全部 + 建立／編輯批改範本、批次批改、匯出報告、產生班級設定檔 |
| 考試模式（由班級設定開啟） | 關閉 AI 產生，只保留編輯器（可選擇保留自我檢查） |

切換機制：
1. **設定頁切換**：切到老師模式時需要輸入 PIN（PIN 的雜湊存在 localStorage）。
2. **班級設定檔**：老師匯出 `class.json`（模型供應商、代理伺服器網址、允許的功能、範本清單、考試模式），透過網址參數 `?class=<json 的網址>` 或匯入檔案套用到學生端。班級設定可鎖定部分選項，學生端不能修改。
3. 老師的 PIN、API KEY **不會**寫進班級設定檔。

---

## 4. 模型供應商與 KEY（功能 3）

### 4.1 Provider 介面
```ts
interface Provider {
  id: 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'proxy';
  listModels(): Promise<string[]>;            // 能列出時自動列出，否則手動輸入
  complete(req: {
    system: string;
    messages: Message[];
    jsonSchema?: object;                      // 結構化輸出
    signal?: AbortSignal;
  }): Promise<{ text: string; json?: unknown; usage?: Usage }>;
}
```
- 各家結構化輸出的寫法不同（JSON schema／tool use），由各個 adapter 自行轉換。
- `openai-compatible` 可以自訂 Base URL，涵蓋 Ollama、LM Studio 等本機服務與相容的雲端服務。
- 不要把模型名稱寫死；優先呼叫各家的 list models API，失敗時改為手動輸入。

### 4.2 瀏覽器直連注意事項
- Anthropic：要加 `anthropic-dangerous-direct-browser-access: true` header。
- Ollama：要設定 `OLLAMA_ORIGINS` 環境變數，允許本站網域。
- 有些服務不支援 CORS → 改用 `proxy` 模式。

### 4.3 設定介面與 KEY 保存
設定頁的操作順序：**平台（下拉選單）→ 模型（下拉選單，選完平台後載入）→ KEY（密碼欄位）→「測試連線」按鈕**。
- 同一個人可以同時設定多個平台的 KEY，作為跨平台的備援。
- 文字模型（產生積木、批改用）和圖片模型（生圖用，§6.4）分開設定。
- KEY 預設只存在 sessionStorage（關掉分頁就清除）；使用者勾選「記住此裝置」才存到 localStorage。教室共用電腦要提醒學生不要勾選。
- 班級設定檔可以限制可選的平台與模型，但**不包含任何 KEY**。
- 介面顯示本次使用的 token 數與預估費用。
- 選配：老師自行部署的代理伺服器（`proxy` provider），提供給沒有 KEY 的情境，不列入近期開發。

### 4.4 模型分級與自動降級
每個平台的模型分成 **高、中、低** 三級。分級表放在 `src/ai/providers/model-tiers.json`，模型推出或下架時只要更新 JSON，不必改程式。平台的模型清單 API 列出、但分級表中沒有的模型，一律當成「未分級」，只能手動選擇。

降級策略（使用者可在設定中選擇）：
| 策略 | 行為 |
|---|---|
| 高階優先（預設） | 從使用者選的模型開始；額度用完時依序往下降一級 |
| 固定模型 | 不自動切換；額度用完時直接顯示錯誤 |
| 省錢優先 | 簡單任務（單一腳本、規則型批改）先用低階；驗證失敗兩次才升一級 |

錯誤分類（各平台的錯誤碼不同，由各 adapter 判斷）：
| 類型 | 例子 | 處理 |
|---|---|---|
| 暫時性限流 | 429 rate limit、503／529 過載 | 指數退避後重試，**不降級** |
| 額度用完 | 額度不足（例如 OpenAI 的 `insufficient_quota`、Gemini 的 `RESOURCE_EXHAUSTED`、餘額不足） | **降一級**後重新送出同一個請求 |
| KEY 無效 | 401／403 | 停止，提示使用者檢查 KEY |
| 最低級也失敗 | — | 若有設定其他平台的 KEY，改用該平台的模型；都失敗才顯示錯誤 |

- 降級時在畫面上提示「已改用 ○○ 模型」，並記錄在批改報告裡（註明哪一份作業是用哪個模型批改的）。
- 降級狀態只在本次使用期間有效；下次開啟或隔天會重新從高階模型開始。
- 低階模型產生的 IR 錯誤率較高，靠 §6.1 的驗證器與重試機制補救。
- 批次批改時，為了讓評分標準一致，可以勾選「降級時暫停」，避免同一批作業被不同模型批改。

---

## 5. 動態積木清單（功能 4 的核心）

**原則：工具箱（flyout）上看得到的積木，就是 AI 可以使用的積木。**

### 5.1 資料來源
1. 從目前工具箱 XML（核心類別，加上 `vm.runtime.getBlocksXML(target)` 取得的擴充類別）列出所有積木的 opcode 與預設 shadow。
2. 從 scratch-blocks 的積木定義（`ScratchBlocks.Blocks[opcode]`）取得欄位名稱、輸入名稱、下拉選單選項、積木形狀（hat、stack、C 型、reporter、boolean、cap）。
3. 擴充積木另外參考 `vm.runtime._blockInfo` 中 `getInfo()` 提供的 `text`、`arguments`、`menus`。
4. 監聽 `EXTENSION_ADDED`、`BLOCKSINFO_UPDATE`、工具箱更新，以及角色切換（舞台與角色的可用積木不同），隨時重建清單。

### 5.2 給 AI 的精簡格式（範例）
```
[motion] motion_movesteps  stack  "移動 (STEPS) 點"  STEPS:number
[control] control_repeat   c      "重複 (TIMES) 次 {SUBSTACK}"  TIMES:whole_number
[pen] pen_setPenColorParamTo stack "筆的 (COLOR_PARAM▾) 設為 (VALUE)"  COLOR_PARAM:menu[color,saturation,brightness,transparency] VALUE:number
```
- 積木文字使用目前介面語言，讓 AI 能對應使用者的說法。
- 積木數量多時，先依提示詞挑出相關類別，或分兩階段（先規劃、再展開），以節省 token。

### 5.3 需要特別處理的積木
| 類型 | 處理方式 |
|---|---|
| 變數／清單積木 | 欄位參照變數 ID；編譯時自動建立或對應既有變數（區分全域與角色私有） |
| 廣播 | `event_broadcast_menu` shadow + 廣播訊息 ID；自動建立訊息 |
| 選單 shadow | 如 `motion_goto_menu`、`looks_costume`、`sensing_touchingobjectmenu`，依清單產生正確的 shadow |
| 自訂積木 | `procedures_definition` / `procedures_prototype` / `procedures_call` 的 mutation（proccode、argumentids 等） |
| 特殊 mutation | `control_stop`（hasnext）等 |
| 第三方擴充 | 只依 `getInfo()` 處理；未知的參數型別一律當成文字 |

---

## 6. 中介表示 IR（功能 1）

AI **不直接輸出 project.json**，改輸出以下 IR（以 JSON Schema 強制格式），由程式編譯成 sb3。

```json
{
  "mode": "merge",                       // merge＝加到目前專案；new＝建立新專案
  "broadcasts": ["開始遊戲"],
  "stage": {
    "variables": [{ "name": "分數", "value": 0 }],
    "backdrops": [{ "library": "Blue Sky" }],
    "scripts": []
  },
  "sprites": [
    {
      "name": "貓咪",
      "existing": false,
      "costumes": [{ "library": "Cat" }, { "svg": "<svg ...>" }],
      "variables": [{ "name": "速度", "value": 5 }],
      "lists": [],
      "procedures": [
        { "proccode": "跳 %s 次", "args": [{ "name": "次數", "type": "string_number" }], "warp": false,
          "body": [ /* blocks */ ] }
      ],
      "scripts": [
        [
          { "opcode": "event_whenflagclicked" },
          { "opcode": "control_forever", "substacks": { "SUBSTACK": [
            { "opcode": "motion_movesteps", "inputs": { "STEPS": { "var": "速度" } } },
            { "opcode": "motion_ifonedgebounce" }
          ]}}
        ]
      ]
    }
  ],
  "explanation": "給使用者看的說明（依簡易／進階模式調整語氣）"
}
```
輸入值可以是：常數 `{"value": 10}`、變數 `{"var": "名稱"}`、清單 `{"list": "名稱"}`、巢狀積木 `{"block": {...}}`、選單值 `{"menu": "_mouse_"}`。

### 6.1 處理流程
1. 組合 system prompt（角色說明 + 積木清單 + 目前專案摘要 + IR schema + 範例）。
2. 簡易模式下，AI 可以先回傳「澄清問題」，問清楚需求再產生。
3. 取得 IR → **驗證器**檢查 opcode 是否存在、輸入與欄位是否合法、積木形狀是否放對位置（reporter 不能當 stack）、引用的名稱是否存在。
4. 驗證失敗 → 把錯誤清單送回 AI 修正（最多 2 次）→ 仍然失敗就顯示錯誤並保留部分結果供檢視。
5. 套用前顯示預覽（要新增的角色、變數、腳本數），使用者確認後才套用。

### 6.2 套用到 VM
- 套用前先存快照（`vm.saveProjectSb3()`），提供「復原 AI 變更」按鈕。
- 新角色：組成 sprite3 JSON → `vm.addSprite()`。
- 既有角色加腳本：`vm.shareBlocksToTarget(blocks, targetId)`。
- 新專案：組成完整 project.json → `vm.loadProject()`。
- 套用後呼叫 `workspace.cleanUp()` 自動排列，並切換到相關角色。

### 6.3 造型與音效來源
IR 的 `costumes` 支援以下幾種來源：
1. `{"library": "Cat"}`：內建素材庫（依名稱比對 TurboWarp 的 library）。
2. `{"svg": "..."}`：AI 直接寫的 SVG，適合簡單圖形。
3. `{"generate": {"prompt": "...", "options": {...}}}`：呼叫生圖 API（§6.4）。
4. 使用者上傳（沿用 TurboWarp 既有功能）。

### 6.4 AI 生圖（Agnes AI）
已查到的公開資訊（Agnes 官方文件版本 2026.07.30，實作前需要再次確認）：
- 相容 OpenAI 格式，Base URL 為 `https://apihub.agnes-ai.com/v1`，使用 `Authorization: Bearer <KEY>`。
- `POST /images/generations`（文字生圖），以及 `/images/edits`（以圖改圖）。
- 模型：`agnes-image-2.0-flash`、`agnes-image-2.1-flash`；可輸出 URL 或 Base64。
- 訂閱方案每天有圖片數量上限，各方案另有每分鐘請求數（RPM）限制。

**待驗證**：瀏覽器能否直接呼叫（CORS），以及是否支援透明背景輸出。不能直連時，生圖改走 `proxy` 模式。

架構上把生圖獨立成 `ImageProvider` 介面（`generate`、`edit`）。Agnes 是第一個實作，之後可以再加入 OpenAI、Gemini 等平台；降級與錯誤分類規則和 §4.4 相同。

#### 生圖選項（核取方塊）
| 選項 | 預設 | 說明 |
|---|---|---|
| 用途：角色／背景 | 角色 | 背景固定 480×360 的比例、不去背；角色預設為正方形 |
| 去背（透明背景） | ✅（角色） | 見下方「去背做法」 |
| 自動裁切透明邊 | ✅ | 裁掉多餘空白，讓碰撞偵測準確 |
| 造型中心置中 | ✅ | 自動設定 rotationCenter，旋轉時不會偏移 |
| 縮放到適合舞台的大小 | ✅ | 角色長邊預設 100～150 px（以舞台座標計算）；點陣圖以 2 倍解析度存檔（bitmapResolution 2） |
| 風格預設 | 卡通 | 卡通、像素、手繪、扁平、寫實；會加進提示詞 |
| 產生左右翻轉版本 | ☐ | 多一個面向相反的造型 |
| 動畫造型（多張） | ☐ | 以第一張為參考圖，用 edits 產生走路、跳躍等連續動作，保持同一個角色的外觀 |
| 轉成向量圖 | ☐ | 點陣轉 SVG，之後可以在造型編輯器裡修改（適合色塊簡單的圖） |
| 壓縮檔案大小 | ✅ | 限制解析度與 PNG 色數，避免專案檔過大 |

產生後先顯示預覽，可以「重畫」或「套用」。套用的造型會加入目前角色，或在 IR 指定的角色裡。

#### 去背做法
1. **快速模式（預設）**：提示詞要求「純色背景」，生圖後從四個邊緣做 flood fill 去除背景色，可調整容許誤差。純前端執行、速度快，適合卡通或扁平風格。
2. **精細模式（選配）**：使用瀏覽器端的 AI 去背模型（ONNX / WebGPU）。模型檔約數十 MB，第一次使用時才下載並快取；選擇套件時要確認授權和 GPL-3.0 相容。
3. API 本身支援透明背景時，優先使用 API 的透明輸出。

#### 兒童安全
- 生圖提示詞先經過文字模型檢查，再送出生圖；不適合的請求會被拒絕，並顯示友善的說明。
- 班級設定檔可以關閉生圖功能，或限制每人每天的張數。

### 6.5 修改既有專案（Patch 操作）
除了新增，IR 也支援用 `ops` 修改專案，單一專案編輯和批次修改（§7.6）共用這套操作：
```json
{ "ops": [
  { "op": "addScript",      "sprite": "貓咪", "script": [ /* blocks */ ] },
  { "op": "deleteScript",   "sprite": "貓咪", "match": { "hat": "event_whenkeypressed", "fields": { "KEY_OPTION": "space" } } },
  { "op": "replaceInput",   "sprite": "貓咪", "match": { "opcode": "motion_movesteps" }, "input": "STEPS", "value": { "value": 5 } },
  { "op": "renameVariable", "from": "score", "to": "分數" },
  { "op": "addSprite",      "sprite": { /* 同 §6 的 sprites 項目 */ } },
  { "op": "addCostume",     "sprite": "貓咪", "costume": { "library": "Cat 2" } },
  { "op": "deleteSprite",   "sprite": "角色2" },
  { "op": "setProperty",    "sprite": "貓咪", "property": "x", "value": 0 }
]}
```
- 為了讓 AI 能夠指定要改哪些積木，送出前先把目前專案轉成「帶有 block ID 的文字版」。`match` 可以使用 block ID，或用條件比對。
- 套用前列出差異（新增 N、刪除 M、修改 K），使用者確認後才套用；支援復原。

---

## 7. 自動批改（功能 2）

### 7.1 批改範本格式
```json
{
  "title": "第三課：貓咪跑步",
  "version": 1,
  "items": [
    { "id": "r1", "points": 20, "type": "rule",
      "desc": "有使用『當綠旗被點擊』", "check": { "usesOpcode": "event_whenflagclicked" } },
    { "id": "r2", "points": 20, "type": "rule",
      "desc": "建立名為『分數』的變數", "check": { "variableExists": "分數" } },
    { "id": "a1", "points": 60, "type": "ai",
      "desc": "碰到蘋果時分數加 1，並讓蘋果移到隨機位置" }
  ],
  "feedbackStyle": "student",
  "scoring": "points",
  "studentView": "itemResult"
}
```
- `scoring`：`"points"` 計分（總分為各項配分加總，AI 項目可以給部分分數）；`"passfail"` 只判斷通過與否（忽略 `points`，可設定「通過 N 項以上算整體通過」，欄位為 `passThreshold`）。在範本編輯畫面以切換開關呈現。
- `rule` 類項目由程式判斷（結果固定、不花 token）：使用某個 opcode、變數或清單存在、角色數量、廣播有發送且有接收、是否有迴圈或條件等。
- `ai` 類項目送給 AI 判斷，要求以 JSON 回傳：`{ id, pass, score, reason, evidenceBlockIds[] }`。
- 自由輸入的標準可以讓 AI 先轉成範本草稿，老師修改後存成範本。
- 為了穩定：temperature 設低、固定 prompt、相同檔案以雜湊快取結果。

### 7.2 單檔批改
- 開啟專案後，在批改分頁選擇範本或直接輸入標準 → 顯示每一項的結果。
- 點選某項時，以 `workspace.glowBlock(id)` 標示相關積木，並自動切換到該角色。

### 7.3 批次批改
- 老師一次選取多個 `.sb3`（或一個 zip、資料夾）。
- 不需要載入編輯器：用 JSZip 讀出 project.json → 轉成可讀文字 → 評分。
- 設定並行數量與重試，處理 API 速率限制；顯示進度、預估費用，可暫停或繼續。
- 檔名解析規則可設定（例如 `座號_姓名.sb3`）。
- **個資**：送給 AI 的內容不包含檔名或姓名，對應只在本機進行。

### 7.4 學生端可見度（`studentView`）
老師在範本設定裡選擇學生自我檢查時能看到多少：

| 設定值 | 學生看到的內容 |
|---|---|
| `full` | 每一項的描述、結果、分數、評語，以及相關積木的標示 |
| `itemResult` | 每一項的描述與通過／不通過（或得分），不顯示評語與積木標示 |
| `countOnly` | 只顯示「通過 X／Y 項」（或總分） |
| `hidden` | 學生端不能自我檢查，只有老師能批改 |

- 這個設定只影響學生端的顯示；老師匯出的報告一律包含完整內容。
- 學生端要用的範本會一起打包進班級設定檔。因為是純前端，懂技術的學生還是能讀到範本內容，這一點要在老師端註明。

### 7.5 報告匯出
- 每個檔案一份 `座號_姓名.md`（各項目結果、分數、評語、相關積木的文字版）。
- 一份總表 `summary.csv`（UTF-8 BOM，Excel 可以直接開；每列一位學生，每欄一個項目）。
- 全部打包成 `批改結果_<範本名>_<日期>.zip` 下載；另外提供 JSON 格式供程式再處理。

### 7.6 批次修改
老師選取多個 `.sb3` 檔案，然後輸入修改指令（自由打字，或使用「修改範本」）。修改有兩種方式：

| 方式 | 適用情境 | 做法 | 費用 |
|---|---|---|---|
| 統一修改 | 每份都加入同一段程式、換掉背景、改變數名稱 | AI 只產生**一次** `ops`（§6.5），由程式套用到所有檔案 | 低（一次 AI 呼叫） |
| 個別修改 | 依各檔案內容調整，例如「修正每份作業中迴圈沒有停止的 bug」 | 每份檔案各自送給 AI 產生 `ops` | 高（依檔案數計算） |

- 統一修改時，先在第一份檔案上預覽結果，確認沒問題後才套用到全部檔案。
- 某份檔案的 `match` 找不到目標（例如沒有那個角色），就跳過這份並記錄原因，不影響其他檔案。
- **絕不覆寫原始檔案**：輸出 `修改結果_<日期>.zip`，裡面是同檔名的新 sb3，加上每份檔案的 `變更紀錄.md`，以及總表 `changes.csv`。
- 修改完可以直接接著執行批次批改，用於驗證修改結果。

### 7.7 進階（之後）
- 動態測試：在 Web Worker 執行 headless VM，模擬綠旗、按鍵，經過 N 秒後檢查變數值或角色狀態。

---

## 8. 介面與年齡層（D7）

| | 簡易模式 | 進階模式 |
|---|---|---|
| 提示詞 | 對話式，AI 會反問、確認需求 | 單次輸入 |
| 說明 | 逐步解釋每段程式在做什麼 | 精簡摘要 |
| 預覽 | 以圖示呈現會新增的內容 | 顯示積木文字與 IR |
| 批改回饋 | 鼓勵式語氣、提示方向，不直接給答案 | 完整說明 |

- 內容安全：system prompt 限制只處理 Scratch 程式相關請求。
- 多語系：沿用 TurboWarp 的 i18n，AI 面板文字先做正體中文與英文。

---

## 9. 部署

- 第一階段：GitHub Actions 建置後部署到 GitHub Pages。
- 第二階段：離線版，可以選擇（a）PWA 加 Service Worker 快取；（b）參考 TurboWarp Desktop 的 Electron 打包。離線時 AI 功能只能使用本機模型（Ollama 等）。

---

## 10. 測試策略

- `compiler` 單元測試：IR → sb3 的 golden files；產生的專案在 Node 中以 scratch-vm 載入，必須沒有錯誤，並且可以反向轉回相同的 IR。
- 驗證器測試：各種錯誤的 IR 都要被擋下，並產生可讀的錯誤訊息。
- 評估集：建立 30～50 個代表性提示詞（不同難度與擴充），定期以不同模型測試成功率。
- 批改一致性：同一份檔案重複批改 5 次，比較結果差異。

---

## 11. 里程碑

| 階段 | 內容 | 完成標準 |
|---|---|---|
| M0 | 匯入 TurboWarp scratch-gui，建置並部署到 Pages | 線上可以開啟編輯器 |
| M1 | Provider 抽象層 + 設定介面（平台 → 模型 → KEY）+ 模型分級與自動降級 | 四種 provider 都能回應測試訊息；模擬額度用完時會自動降一級 |
| M2 | 積木清單 + IR + 編譯器（核心積木、單一角色腳本） | 「綠旗後重複移動」類需求可以正確產生 |
| M3 | 角色、造型（素材庫、SVG）、變數、清單、廣播、自訂積木；新專案模式；復原 | 能產生多角色互動的小遊戲 |
| M4 | 官方與第三方擴充的動態清單 | 載入畫筆、音樂與一個第三方擴充後都能產生積木 |
| M5 | AI 生圖（Agnes）+ 後製選項（去背、裁切、置中、縮放） | 產生的角色造型背景透明，且中心點正確 |
| M6 | Patch 操作（修改既有專案）+ 單檔批改（自由輸入 + 積木標示） | 能修改指定的積木；批改能標出依據的積木 |
| M7 | 批改範本（計分方式、學生可見度）+ 批次批改 + 報告匯出 | 30 份檔案可以一次批改並匯出 zip |
| M8 | 批次修改（統一修改、個別修改） | 30 份檔案統一加入一段程式，且原檔不變 |
| M9 | 模式切換、班級設定檔 | 學生端套用班級設定後功能受限 |
| M10 | 離線版 | 斷網後可以開啟編輯器 |

---

## 12. 待決事項

- [x] 批次修改：批次批改與批次修改都要（§7.6）
- [x] 計分方式：分數或通過／不通過，可以切換（§7.1）
- [x] 學生可見度：由老師對每個範本設定（§7.4）
- [x] KEY：每位學生自備，並自動降級（§4.3、§4.4）
- [x] 生圖：接 Agnes AI，加上後製選項（§6.4）
- [ ] Agnes API 能否從瀏覽器直接呼叫（CORS）、是否支援透明背景輸出 → M5 開始前實測
- [ ] 模型分級表的初始內容（每個平台的高、中、低階模型）→ M1 實作時依當時的模型清單填入
- [ ] repo 結構：直接把 TurboWarp scratch-gui 匯入本 repo（建議），或是另外 fork 一個 repo
