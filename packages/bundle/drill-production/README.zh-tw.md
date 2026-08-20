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
- 生產 preset 不提供 Bash、PowerShell、通用檔案系統、workflow、Ralph 或外部行程 subagent。
- permission preset 嚴格為 `read-only` 與 `workspace-write`；伺服器端不存在 `danger-full-access`。
- directory picker 使用 disabled provider；所有真實 picker RPC 返回 `directory-picker-unavailable`。
- `cordis-host-runner` 被停用，動態 Cordis 執行不可用。
- `session-query-sqlite` 保持 `openAt: never`。

## Startup policy check

啟動與單元測試共用純驗證器。所有 patch 套用後，它驗證精確的 preset、預設值、使用者根開關和 permission 對映；偏移會讓啟動以明確診斷失敗，不會靜默降級。

## Model Experience

### Production tool roster

#### What the model sees

此 bundle 不加入 prompt 文字。`drill-production` preset 只暴露保留的安全工具，並省略 shell、通用檔案系統、workflow、Ralph、外部行程 subagent 與動態 Cordis 工具。

#### Token effect

請求只包含保留工具的 schema；bundle 本身不加入文字 token。

#### KV Cache effect

掛載後的生產工具集合保持穩定，因此不會造成逐輪 cache 失效。

## Known Limitations and Deferred Work

- A3 不實作作業系統級沙盒。檔案讀取、網路、Unix socket、行程/PID 和資源限制屬於 Issue #5。
- 使用者自訂 preset 完全關閉；未來若開放，必須驗證其中每個外掛程式，而不只是 preset id。
- SQLite 查詢索引不是 host 執行路徑，因此未納入啟動驗證器。
