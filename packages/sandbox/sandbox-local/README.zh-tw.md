# @deepseek-ai/dsh-sandbox-local

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[`dsh-sandbox`](../sandbox/) seam 的本機實作。它選擇並快取一個平臺 runner：Linux 優先選擇可工作的 `bwrap`，其次選擇 PID 隔離與 Landlock 組成的 runner；macOS 使用 Seatbelt；Windows 使用 ACL 受限權杖 runner。多個候選項會按順序探測，只有一個候選項時則直接選擇。

包根目錄匯出預設及命名的 `LocalSandboxProvider` 外掛程式和 `Config`；平臺 profile builder 仍為內部實作。

不受支援的平臺和不可用 runner 會以 `SANDBOX_UNAVAILABLE` 拒絕執行；執行絕不會靜默回退為不受限制。每次包裝都攜帶結構化 runner 失敗規則，使消費端能夠區分損壞的沙盒與命令失敗。[沙盒 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) 負責說明選擇依據與 profile 差異。

策略逐呼叫傳入；提供方只儲存機制與快取的 runner 結論。每次包裝都會報告強制執行完整度，以及後端專用的拒絕簽名和 runner 失敗規則。Landlock 只有在結束碼為 125，且僅排除完全匹配的部分強制執行通知後仍存在一行 `landlock-run:` 致命診斷時，才判定 runner 失敗；攜帶該通知的子行程即使以 1、2 或 125 結束，也仍按子行程結果處理。Bubblewrap 和 Seatbelt 仍僅依據簽名，因為兩者的公開約定均未保留 launcher 失敗狀態。消費端會直接 spawn 返回的 argv，因此 runner 缺失或不可執行屬於帶外 spawn 失敗，而成功啟動的子行程以 126 或 127 結束時仍按普通結果處理。`runnerCommand` 會跳過探測，並要求為自訂 runner 自身的致命方言提供一個或多個非空、單行、不區分大小寫的 `runnerFailureSignatures` 條目。由於其機制未知，它會同時攜帶兩種 Linux 拒絕方言。`probeTimeoutMs` 限定功能探測的時長。[沙盒 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) 負責說明選擇與失敗語義。

Seatbelt profile 預設允許，但帶 `(deny file-write*)` 和寫入 allow-list，因此恰好約束相應模式承諾的文件操作：`read-only` 只授予 `/dev/null` 字面路徑；`workspace-write` 另加工作區根目錄、`/tmp` 和逐使用者 darwin 臨時目錄（`os.tmpdir()`，即平臺供 mkstemp 家族工具使用的真實臨時區域）。每個根目錄都經過規範化，因為 Seatbelt 匹配解析後的路徑（`/tmp` 就是 `/private/tmp`）。Apple 將 `sandbox-exec` CLI（命令列介面）標為 deprecated，但所有 macOS 系統仍會提供它；若情況發生變化，功能探測會使執行被拒絕。

Windows 檔為每個工作區保留一個確定性寫入 SID 和常駐 ACE，但為每個活躍的工作階段/工作區對分配一個隨機私有臨時目錄，以及不同的 SID 和可撤銷 ACE。因此，共享工作區的工作階段會共享預期的寫權限，卻不會繼承彼此的臨時目錄權限。新的提供方總會選擇新的臨時路徑和 SID，因此崩潰殘留既無法阻止復原的工作階段，也無法向其授權；runner 會為無 agent（代理）的呼叫提供同樣的逐呼叫隔離。如果工作區等於或包含平臺臨時根目錄，呼叫會在任何 ACL 改動發生前失敗，因為否則其可繼承的工作區 ACE 會延伸到每個私有臨時子目錄。

[`@deepseek-ai/node-addon-landlock-run`](https://www.npmjs.com/package/@deepseek-ai/node-addon-landlock-run) 提供平臺 launcher、功能探測和 CLI 參數詞彙。該提供方只負責模式到授權的對映與 runner 選擇。把路徑解析和探測解析保留在帶版本的 binary 中，可防止約定漂移。

Linux Landlock profile 允許讀取工作階段 workspace 以及 `/usr`、`/etc/ld.so.cache`、`/etc/alternatives`；寫入權限仍由模式決定。受信任消費方傳入的絕對外層執行檔會獲得只針對該檔案的讀取授權，使 ripgrep 一類隨附靜態工具可到達 `execve`，但不會授權其上級 runtime 目錄。系統根目錄支援普通執行檔與 merged-usr loader symlink（符號連結）。外層 [`@deepseek-ai/node-addon-pid-isolate-run`](../../../native/pid-isolate-run/) launcher 先建立獨立 PID namespace 與 procfs，內層 Landlock launcher 再施加檔案系統規則。部署必須對已安裝的 binary 執行 `setcap cap_sys_admin,cap_setpcap+ep` 並驗證 `--probe`；否則組合 runner 不可用，且沒有更前面的 runner 時會失敗閉合。Bubblewrap 不使用此特權 helper。

可選的 Linux 資源限制會在所選 runner chain 最外層加入 `systemd-run --user --scope`。`cpuQuotaPercent` 對映到 `CPUQuota`；`maxTasks` 對映到 `TasksMax`；`walltimeSeconds` 對映到 `RuntimeMaxSec`，`timeoutStopSeconds` 控制從 SIGTERM 到 SIGKILL 的寬限期，預設 2 秒。`memoryMaxBytes` 始終攜帶 `MemorySwapMax`：省略 `memorySwapMaxBytes` 時會安全地解析為零，而只設定 swap、不設定 memory 會被拒絕。第一次受限呼叫會進行功能探測，證明使用者 manager 能建立 scope，且 cgroup v2 記錄了預期的 CPU、memory、零 swap 與工作限制。缺少使用者 systemd 或 D-Bus 支援時會以 `SANDBOX_UNAVAILABLE` 失敗閉合；所有限制均未設定時則明確省略該層。

`walltimeSeconds` 是部署層級上限，不會取代 Bash 與 PowerShell 執行器逐請求的前景 timeout。執行器 deadline 保留逐呼叫 override 與模型可見的 `timedOut` 分類，同時已經會終止 detached process tree；背景 shell 執行不使用該 deadline。systemd 上限還會涵蓋背景執行與 launcher chain。先到期的一方會終止整棵樹；systemd 先到期時會報告為 signal 結果，而不是執行器 timeout。

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
  config:
    cpuQuotaPercent: 50
    memoryMaxBytes: 1073741824
    maxTasks: 256
    walltimeSeconds: 300
```

消費端：[`@deepseek-ai/dsh-bash-sandbox`](../../shell/bash-sandbox/)；可執行的預設組合見 [acp-agent 示例](../../../examples/acp-agent/)。

## 模型體驗

透過 [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md) 和 [`dsh-tool-bash`](../../shell/tool-bash/README.md) 間接影響；它們算繪該提供方的強制執行與拒絕事實，而 [`dsh-sandbox`](../sandbox/README.md) seam 負責定義 `SANDBOX_UNAVAILABLE` 文字，runner 選擇與 profile 則不進入上下文。

#### KV Cache 影響

不會直接使 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **Windows ACL 只能實作部分強制執行**：受限權杖必須保留 Everyone 以完成行程初始化，因此授予 Everyone 寫訪問的外部對象仍可寫；NTFS 硬連結也會使工作區路徑與外部路徑指向同一個文件對象。提供方報告 `enforcement: 'partial'`，而不會把該邊界誇大為完整強制執行。
- **Landlock 可能只實作部分強制執行**：較舊且受支援的核心 ABI 只能限制自身公開的訪問類別，因此報告 `enforcement: 'partial'`，不會誇大為完整強制執行。
- **Seatbelt 相依性已棄用的 `sandbox-exec`**：macOS 仍會提供它，但若 Apple 移除該私有策略引擎，該提供方無法替換或探測。
- **runner 選擇在提供方生命週期內快取**：安裝、移除或修復 runner 後，必須重載外掛程式才能改變選擇。
- **`runnerCommand` 是操作方斷言**：設定的自訂 runner 會跳過功能探測，並假定它誠實實作與 bwrap 相容的 profile；如果它本身是 Bash 指令碼，其解釋器啟動發生在該指令碼施加約束之前。
- **資源限制需要使用者 systemd manager 和已委派的 cgroup v2 controller**：功能探測無法連線使用者 D-Bus，或無法觀察所需的 `cpu`、`memory` 與 `pids` controller 值時，已設定的限制會失敗閉合。
