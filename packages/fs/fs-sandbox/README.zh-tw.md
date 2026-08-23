# dsh-fs-sandbox：強制沙盒的檔案系統後端

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`SandboxedFileSystem` 擴充 [`LocalFileSystem`](../fs-local/README.md) 並註冊為 `ctx.fs`。它繼承本機儲存機制，並增加按呼叫的讀取和變更圍欄。兩種受限模式都只允許讀取呼叫工作階段的工作區；寫入仍使用各模式的可寫根規則。

它原樣複用本機後端設定：`cwd` 仍是相對路徑的解析預設值，`diffBasisMaxBytes` 則限制選填的覆寫上下文 diff 基礎。

只需載入它來替代 `dsh-fs-local`，並同時載入 [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/README.md)，即可完成替換；面向模型的工具（`dsh-tool-fs`）無需改動。工具層把呼叫工作階段的模式和 cwd 解析為與 bash 相同的按呼叫策略，因此兩個能力族絕不會約束到不同根目錄。

## 圍欄

按呼叫策略攜帶有效模式（工作階段覆蓋值或升級授權）和呼叫工作階段不可變的 cwd 根目錄；只有沒有工作階段的呼叫纔回退到部署策略：

- `read-only`：以結構化 `FS_SANDBOX_DENIED` 拒絕所有變更；
- `workspace-write`：只有目標規範化後位於可寫根目錄下，才允許變更。可寫根包括工作區根目錄和平臺臨時區域（`/tmp`、`os.tmpdir()`），與 Seatbelt profile 授權的集合相同；該集合由唯一的 [`writableRoots`](../../sandbox/README.md) 函式派生，使 fs 圍欄與 bash runner 不會漂移。規範拼寫使用詞法快速路徑；基於身份的祖先回退可以識別 Windows 長名稱和 8.3 名稱等別名等價根目錄，而不會把無關前綴視為包含關係。委託前會立即重新規範化目標，因此工具解析後被替換的祖先符號連結也會被發現；
- `danger-full-access`：不加圍欄直接委託。

對於讀取，`read-only` 和 `workspace-write` 都只允許由 [`readableRoots`](../../sandbox/README.md) 派生的規範化工作區根目錄。接收已解析目標的方法檢查提供方的規範化目標身分。`lstat` 會先規範化並檢查父目錄，再檢查最後一個路徑條目，因此可以報告工作區內的符號連結，而不會跟隨該連結進入工作區外。`stat`、文字／位元組讀取或目錄列舉若跟隨最終符號連結解析到外部目標，則會被拒絕。

## 威脅模型：策略圍欄，而非核心邊界

圍欄是在可信程式碼中檢查模型控制的路徑。操作本身屬於 seam（open、rename），只有目標路徑不可信，因此「規範化後檢查包含關係」就是該介面的完整答案。這與 `code-runtime` 的立場相同：提供約束，但不是安全邊界。不可信程式碼的核心級隔離仍由 `ctx.shell` 負責（[`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md)）。剩餘 TOCTOU（在包含關係複查與系統呼叫之間替換祖先符號連結）會透過寫入前立即重新規範化來縮小，並為該威脅模型所接受；核心嚴密邊界需要 `openat2` 一類原語，其可移植性成本在此不值得。

拒絕是結構化 `FsError`（`FS_SANDBOX_DENIED`，攜帶有效模式），不透過 stderr 文字推斷（不同於 bash 的核心拒絕），因為行程內圍欄準確知道自己拒絕了什麼。面向模型的 `[sandbox: file access denied under <mode> mode]` 標記以及唯一一次獲批的更寬權限重試位於工具層（`dsh-tool-fs`），與 bash 完全相同。見[跨能力族 fs 沙盒 Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)。

## 模型體驗

### 檔案系統策略與拒絕

#### 模型看到的內容

策略歸屬方會貢獻與具體能力無關的 `sandbox:policy` 上下文。作為間接影響，`dsh-tool-fs` 會把本後端的 `FS_SANDBOX_DENIED` 拒絕算繪為 `[sandbox: file access denied under <mode> mode]` 標記和同輪次升級提示。

#### Token 影響

該後端掛載期間，當前策略條款會增加一條簡短的執行時期上下文訊息；拒絕則會把有界標記和升級提示追加到對話歷史。

#### KV Cache 影響

常駐策略發生變化時，會在保留的歷史之後追加一份由歸屬方算繪、取代先前狀態的執行時期上下文快照；操作結果保持僅附加。

## 已知限制與暫緩事項

- **策略圍欄，而非核心邊界**：該檢查是可信程式碼處理模型控制的路徑，因此解析到系統呼叫之間殘留的 TOCTOU 會被原位重新規範化縮小，但不會消除；對抗性宿主行程不在範圍內。不可信程式碼的核心級隔離仍屬於 `ctx.shell`。
- **讀取圍欄位於行程內**：它限制 `ctx.fs` 讀取和明確的 `tool-fs-search` 根目錄；通用 shell 程式碼的核心級讀取隔離屬於獨立的行程沙盒工作。
- **圍欄與 runner 的一致性由單一所有方派生**：可寫集合來自 `writableRoots`，該函式與 Seatbelt profile 共享；在其他位置定義可寫集合的 runner profile 會發生漂移。
- **要求 `ctx.sandboxPolicy`**：工具使用它解析每個工作階段策略，後端用它處理無 agent（代理）呼叫的回退；未組合該服務時，後端不會實施約束。
