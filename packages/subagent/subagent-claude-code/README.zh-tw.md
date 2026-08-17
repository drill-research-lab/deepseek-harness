# @deepseek-ai/dsh-subagent-claude-code

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本包（package）註冊固定的 `claude-code` subagent 提供方。每次接受執行請求後，它都會在發起委託的工作階段工作區中呼叫官方 Claude Agent SDK，透過共享子行程服務解析原生 `claude` 可執行文件，提交一個自包含的文字任務，並透過共享的 [`dsh-subagent`](../subagent/README.md) 結果約定僅返回最終答案。

## 啟動與所有權

`start(request)` 只接受非空的文字塊序列，並根據父工作階段確定子級 cwd。它會建立一個私有 `AbortController`，呼叫官方 SDK 的 `query()`，並僅在 SDK 的 `spawnClaudeCodeProcess` 掛鉤已經提供由 [`dsh-subprocess`](../../subprocess/subprocess/README.md) 管理的活動 CLI 控制代碼後發布此次執行。若在發布前發生失敗或取消，它會關閉 query、終止所有已取得的行程樹並等待其結束，然後拒絕 `start()` 呼叫。

SDK 接收由文字塊原樣拼接成的任務。提供方會完整迭代 SDK 訊息流，而且只接受滿足以下條件的 `result` 訊息：其 `subtype: "success"`、`is_error: false` 且 `result` 非空白，之後迭代器還須正常結束。所有 SDK 錯誤子類型、標記為錯誤的成功訊息、缺失答案、迭代器失敗、協定失敗或行程失敗都對映為 `error`；該提供方不會產生 `max-tokens` 或 `refusal`。

本機取消會在結果競態中勝出並對映為 `aborted`。`dispose()`（資源釋放）具有冪等性：它會中止此次執行、請求 SDK query 關閉、呼叫共享的行程樹逐級終止機制，並等待整棵行程樹結束。SDK 的優雅關閉只表達協定意圖；行程是否完全靜止仍以子行程控制代碼為準。結果失敗與獨立的清理失敗仍彼此分離。

## 原生設定與互動

提供方故意省略 SDK 的 `settingSources` 選項。因此，官方 SDK 會相對於父工作階段 cwd 讀取宿主機常規的使用者、項目和本機 Claude 設定，包括原生帳戶狀態與產品設定。提供方既不複製也不過濾這些文件，也不會建立或修改登入狀態。

每次 query 都設定 `persistSession: false` 並停用 `AskUserQuestion`。提供方不設定 `canUseTool`、elicitation 或對話回呼，因此無人值守互動會經 SDK 失敗，而不會等待本提供方不負責的使用者介面。

## 能力與上下文

本提供方不聲明任何選填的啟動時能力，並報告 `inheritsParentContext: false`。Claude Code 會接收獨立文字任務和父工作階段 cwd，但不會接收父工作階段的對話、角色設定、工具篩選器、深度策略或結構化輸出約定。每次執行都擁有獨立的 SDK query、取消控制器、CLI 行程和不持久化的產品工作階段。

## 設定

| 設定鍵 | 預設值 | 含義 |
|---|---|---|
| `env` | `{}` | 顯式指定的 SDK/CLI 環境，疊加在由共享機制清除憑證後的父環境之上。 |
| `disposeGraceMs` | `3000` | 共享行程樹責任方各終止層級之間的寬限期，單位為毫秒且須為正有限值，並不得大於倉庫共享的 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)；隨後資源釋放會等待整棵行程樹結束。 |

生產環境從子行程執行世界清除憑證後的 `PATH` 解析 `claude`，再應用顯式 `env` 條目，並把所得路徑作為 `pathToClaudeCodeExecutable` 交給 SDK。在 Windows 上，解析到的 `.cmd` 或 `.bat` 路徑會作為帶引號、僅供本次 spawn 使用的環境值交給 `cmd.exe /v:off` 展開一次，因此合法路徑中的元字元仍只是資料。鎖定版本的 SDK 隨後把固定命令列選項放在 cmd 的命令尾部；這些選項不含 cmd 元字元，也並不是普通的 Windows argv。原生設定與身分驗證繼續是權威來源。本外掛程式不安裝另一份 CLI、不選擇模型、不建立產品主目錄、不執行登入，也不探測帳戶。具有憑證特徵的環境變數會在顯式 `env` 覆蓋生效前被清除，因此供子行程使用的 API 金鑰或 token 必須在該設定中顯式提供。除非被覆蓋，`ANTHROPIC_BASE_URL` 等非憑證端點變數以及 `PATH` 和 `HOME` 等普通環境變數仍會被繼承。

生產 `dsh` 不會安裝或掛載這個選填提供方。選擇啟用它的 Profile 必須安裝 `@deepseek-ai/dsh-subagent-claude-code`，並在 host plane（宿主平面）掛載一次；載入提供方本身不會在工具呼叫前啟動 Claude 行程。完整 Agent Preset 攜帶對應的產品工具行並設定 `disabled: true`；複製一個 preset 後刪除該欄位，即可只向由該副本組裝的 agent 暴露 `subagent_claude_code`。其 `one-shot` 策略會讓省略 `run_in_background` 或傳入 `false` 的呼叫繼續在前臺等待，而顯式傳入 `true` 會返回由父 agent 擁有的 Job ID，供 `job_output` 或 `job_kill` 使用。base host（基礎宿主）與完整 preset 已提供通用作業登錄檔和控制工具。

下列獨立組裝展示完整的顯式能力。基於 `@deepseek-ai/dsh-base` 的 Profile 保留已有 Job 行，只新增產品提供方行並啟用 preset 工具行，禁止重複掛載 Job 服務。

```yaml
- id: subagent-claude-code
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY

- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-subagent-claude-code
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: claude-code
    toolName: subagent_claude_code
    backgroundMode: one-shot
    maxDepth: provider-managed
```

## 產品相容性與證據

執行時期相依性精確鎖定為 `@anthropic-ai/claude-agent-sdk@0.3.220`。生產執行使用原生 `claude` 安裝。無金鑰真實產品測試使用由 SDK 分發的 Claude Code 2.1.220 CLI 作為確定性 fixture（測試前置資料），並透過同一套原生可執行文件解析路徑與 Windows batch shim 路徑執行；這項測試不聲稱相容每個獨立安裝的版本。Loader 組合證明兩個產品包能夠共存且不會啟動任一產品。

限定於項目所有者身份的分發授權涵蓋官方 SDK 及每個 SDK 版本聲明的官方 CLI／平臺載荷。[`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) 會披露當前選填載荷閉包，但不會認定其中聲明的條款屬於寬鬆許可；其他無關的非寬鬆執行時期相依性仍會使第三方聲明閘門失敗。

## 模型體驗

### 子級請求

#### 模型看到的內容

Claude Code 子級會在一個全新的 SDK query 中接收獨立文字任務。它的工作區是父工作階段 cwd；其模型、系統指令、工具、權限和身分驗證來自宿主機原生 Claude 設定與產品安裝。

#### 對 token 的影響

子級需為獨立的 Claude Code 上下文和 query 承擔 token 開銷。子級 token 不會進入父級上下文。

#### 對 KV Cache 的影響

這與父請求快取相互獨立。能否複用只取決於 Claude Code 自身的模型、指令、工具、原生設定和全新 query。

### 父級調度與結果（間接）

#### 模型看到的內容

透過 `dsh-tool-subagent`，前臺呼叫會讓父級模型看到符合嚴格成功條件的 Claude Code 最終答案，或者在結果未完成時看到消費端給出的原樣錯誤。後臺呼叫會先返回 Job id；隨後通用作業控制面會送達完成通知，透過 `job_output` 公開最終答案與狀態，並允許 `job_kill` 請求取消。Claude Code 的推理、工具活動、中間訊息、stderr、工作區差異、用量資訊和產品識別符號均不會複製到父工作階段。

#### 對 token 的影響

前臺輸入會增加工具結果中保留的最終答案或錯誤內容。後臺輸入還會包含啟動確認、完成通知，以及 `job_output`、`job_kill` 或後續狀態結果；子任務 token 仍不會進入父級上下文。本提供方自身不新增父級工具 schema。

#### 對 KV Cache 的影響

僅附加：前臺會在可複用的父請求前綴後增加一個結果，後臺則會繼續追加 Job 啟動確認、通知以及後續控制或收集結果。後臺調度可能增加一個由通知喚醒的輪次，但這些訊息都不會改寫更早的前綴。

## 已知限制與後續工作

- **每次執行均新建一個 query 和一個行程**：不支援續接、復原、池化、進度流或產品工作階段持久化。
- **宿主設定有意保持權威**：項目和使用者設定可以改變模型、工具與行為；本提供方不提供經過篩選或與宿主環境隔離的生產模式。
- **產品安裝與帳戶狀態仍由原生機制管理**：`claude` 缺失或不相容、設定錯誤或身分驗證失敗都會呈現為啟動錯誤或執行錯誤；本外掛程式不提供安裝程序或登入流程。
- **SDK 平臺 CLI 仍在安裝閉包內**：生產環境會忽略它，改用宿主提供的 `claude`，但當前 SDK 的選填相依性仍會安裝，並提供無金鑰相容性 fixture。移除該載荷屬於獨立的產品安裝閉包後續項。
- **沒有人工互動路徑**：`AskUserQuestion` 被停用，其他互動回呼也不存在，因此需要新審批或輸入的任務會失敗而不會掛起。
- **產品載荷僅包含最終文字**：推理、中間訊息、工具通訊、用量資訊、stderr 和工作區差異仍只保留在產品內部；通用 Job id、通知與狀態來自共享作業執行時期。
- **沒有選填的共享能力**：對於本提供方，共享服務會拒絕輸出 schema、子任務角色設定、工具篩選和 harness 深度強制約束。
- **沒有按實際經過時間觸發的逾時或副作用回滾**：長時間執行的工作由呼叫方取消，且取消前已更改的文件或外部系統不會復原原狀。
