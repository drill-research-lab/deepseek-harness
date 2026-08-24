# @deepseek-ai/dsh-drill-production

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Drill 多使用者生產組合閉包。此 bundle 必須在 profile 中依序疊加於 `@deepseek-ai/dsh-base` 與 `@deepseek-ai/dsh-web-app` 之後；未載入時，A3 保證不生效。

## Usage

在 profile 的 `dsh.profile.bundles` 中加入：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-drill-production"]
    }
  }
}
```

此 bundle 是選用部署層，不改變一般單使用者 Web 或 CLI/TUI 組合。

## What this closes

- preset 集合嚴格為 `drill-production`，預設值也必須是它，並關閉使用者 preset 根目錄。
- 生產 preset 提供受共享逐工作階段沙盒策略約束的 Bash 或 PowerShell、通用檔案系統與檔案系統搜尋工具。檔案系統讀取限制在工作區內；Linux 子行程另受 Landlock 文件限制及 `pid-isolate-run` 私有 PID 命名空間保護。workflow、Ralph 與外部行程 subagent 仍不提供。
- permission preset 嚴格為 `read-only` 與 `workspace-write`，`sandbox-policy.maximumMode` 固定為 `workspace-write`；工具 schema 與執行時期授權都不會接受 `danger-full-access`。
- directory picker 使用 disabled provider；所有真實 picker RPC 返回 `directory-picker-unavailable`。
- `cordis-host-runner` 被停用，動態 Cordis 執行不可用；啟動檢查同時斷言 `dynamicCordisRunner` 未掛載。
- `session-query-sqlite` 保持 `openAt: never`；啟動檢查會重新核實這一點。

## Startup policy check

啟動與單元測試共用純驗證器。所有 patch 套用後，它驗證精確的 preset、預設值、使用者根開關、permission 對映、沙盒上限 `workspace-write` 與精確升權目標 `{workspace-write}`、`dynamicCordisRunner` 未掛載，以及（當 sqlite session-query 引擎已掛載時）`openAt: 'never'`；偏移會讓啟動以明確診斷失敗，不會靜默降級。

## Model Experience

### Production tool roster

#### What the model sees

此 bundle 不加入 prompt 文字。`drill-production` preset 會暴露受限制的 shell、通用檔案系統、檔案系統搜尋與原有保留工具，並省略 workflow、Ralph、外部行程 subagent 與動態 Cordis 工具。shell 與可變更檔案系統的 schema 只展示 `workspace-write` 這一升權目標。

#### Token effect

請求只包含保留工具的 schema；bundle 本身不加入文字 token。

#### KV Cache effect

掛載後的生產工具集合保持穩定，因此不會造成逐輪 cache 失效。

## Known Limitations and Deferred Work

- 文件及 Linux 行程隔離不限制出站網路，也不提供 CPU、記憶體或磁碟配額。
- 使用者自訂 preset 完全關閉；未來若開放，必須驗證其中每個外掛程式，而不只是 preset id。
- 啟動驗證器不單獨核實 `session-persistence-sqlite`：該後端在此組合中從不掛載，也沒有 `openAt` 一類的可漂移設定；只有 `session-query-sqlite`（一個獨立的讀取／全文索引套件）會被重新核實。
