# @deepseek-ai/dsh-mcp-client

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

MCP 用戶端橋接外掛程式：連線外部 [Model Context Protocol](https://modelcontextprotocol.io/) 伺服器，把它們的工具註冊到 `ctx.tools`，使模型能夠透過伺服器限定名稱（`mcp__<serverName>__<rawName>`）將其作為原生工具使用。

## 用法

`cordis.yml` 中每個 MCP 伺服器使用一個外掛程式實例：

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

模型會看到 `mcp__github__create_issue`、`mcp__web__search` 等工具，這與 Claude Code 和 Codex 使用的伺服器限定形狀相同。HMR（熱模組替換）支援熱替換：編輯設定項會觸發中斷連線 + 重新連線，無需重新啟動行程；`serverName` 不變時會生成完全相同的工具名稱。

## 設定

| 欄位 | 傳輸 | 必填 | 描述 |
|---|---|---|---|
| `transport` | 兩者 | 是 | `"stdio"` 或 `"streamable-http"` |
| `serverName` | 兩者 | 是 | 該伺服器面向模型工具名稱的 namespace；`[A-Za-z0-9_-]{1,32}`，在存活實例中唯一 |
| `command` | stdio | 是 | 要 spawn 的可執行文件 |
| `args` | stdio | 否 | 傳給命令的參數 |
| `env` | stdio | 否 | 合併到已清理環境中的額外環境變數 |
| `cwd` | stdio | 否 | 子行程工作目錄 |
| `url` | http | 是 | MCP 伺服器 URL |
| `headers` | http | 否 | 額外標頭（例如驗證 token） |
| `toolCallTimeoutMs` | 兩者 | 否 | 每次 `callTool` 呼叫的逾時（預設 60000） |
| `failOnStartupError` | 兩者 | 否 | 初始連線或工具同步失敗時拒絕外掛程式啟用（預設 `false`） |
| `reconnect.enabled` | 兩者 | 否 | 連線丟失後自動重新連線（預設 `true`） |
| `reconnect.initialDelayMs` | 兩者 | 否 | 首次重連延遲（毫秒）；每次連續失敗嘗試翻倍（預設 500） |
| `reconnect.maxDelayMs` | 兩者 | 否 | 退避上限（毫秒）；同時也是重設嘗試預算所需的正常執行時期長（預設 30000） |
| `reconnect.maxAttempts` | 兩者 | 否 | 每次中斷期間連續失敗嘗試次數上限，超出後徹底放棄（預設 10） |

## 工具命名

每個 MCP 工具都有兩個名稱：透過 `tools/call` 在協定上傳送的原始 MCP 名稱，以及公開名稱 `mcp__<serverName>__<rawName>`，後者註冊到 `ctx.tools`。公開名稱會規範化為 DeepSeek 函式名稱約定（64 個字元、`[A-Za-z0-9_-]`）；如果替換或截斷改變名稱，就會追加 `(serverName, rawName)` 的確定性 12 位十六進位 hash，確保不同工具絕不會摺疊為同一個名稱。名稱是 `(serverName, rawName)` 的純函式：連線順序、重新同步和其他伺服器永遠不會重新命名工具。

- 發布相同原始名稱（例如 `search`）的兩個伺服器會在各自 namespace 下共存。
- 存活實例中的重複 `serverName` 會使後加載的外掛程式實例失敗。
- 伺服器在工具清單中兩次列出同一工具名稱時，該清單會作為無效工具清單被拒絕。
- 外部註冊搶佔該伺服器 namespace 時，會回滾整個世代（絕不保留部分集合），並明確報錯。

## 行為

- 連線時：外掛程式啟用會等待 `listTools()`，並在組合開始首個輪次前透過 `ctx.tools.register()` 以公開名稱註冊每個工具。初始連線、發現或註冊失敗始終會記錄日誌；`failOnStartupError` 為 true 時拒絕啟用，否則外掛程式仍會啟用但不註冊工具。
- 監聽 `notifications/tools/list_changed` → 重新同步；取得階段失敗時保留上一世代的註冊，註冊衝突則會回滾本次嘗試的世代，並且不保留該伺服器的任何工具。
- 工具執行：`client.callTool({ name: rawName, arguments }, { signal })`，支援逾時 + 中止；公開名稱絕不會發給伺服器。
- 規範成功值是 `{ content: JsonValue[], structuredContent? }`；完整的 JSON MCP 塊會保留給程式設計呼叫方。受支援且已聲明的 `outputSchema` 會驗證 `structuredContent`；不受支援的 schema 詞彙會回退為不受約束的 `JsonValue`。
- Native／模型算繪會保留 MCP 塊順序。文字類連續塊以換行連線；資源連結以文字保留名稱和 URI；只有掛載 `ctx.attachments` 且確切呼叫模型路由明確聲明支援圖片輸入時，受支援的圖片才會成為持久核心圖片塊。整個圖片批次會先完成解碼與准入，再保存任一成員。格式錯誤或被拒絕的圖片批次、音訊、嵌入資源和不受支援的塊會成為明確診斷文字，而不會消失。
- 中斷連線／崩潰時：supervisor 以指數退避（`reconnect.initialDelayMs` 逐次翻倍，上限 `reconnect.maxDelayMs`）重新啟動原始伺服器設定，成功後重新執行發現——復原的世代會替換前一個，因此工具既不會重複也不會洩漏。中斷期間最後一個正常世代保持註冊；針對它的呼叫在復原前會失敗。
- 重連按中斷預算控制：連續失敗達到 `reconnect.maxAttempts` 次後，該伺服器的工具會被註銷，重連停止，直到 HMR 重載或重新啟動 Host。連線存活超過 `maxDelayMs` 會重設預算，因此偶爾崩潰的伺服器可以無限復原，而崩潰迴圈的伺服器——即使短暫連線成功——仍會耗盡上限而非永遠重新啟動。
- 重連狀態在日誌中對使用者可見：reconnecting（warn，含嘗試次數和延遲）、recovered（info）、最終失敗和 disabled-loss（error）。dispose（資源釋放）會取消任何待執行的重連。設定 `reconnect.enabled: false` 時，連線丟失後工具保持註冊但呼叫失敗，直到重載——即手動復原行為。

## 消費的服務

| 服務 | 用途 |
|---|---|
| `ctx.tools` | 註冊／註銷 MCP 工具 |
| `ctx.attachments` | 選填；在模型投影前校驗並持久保存圖片結果批次 |
| `ctx.llm` | 選填；證明確切呼叫路由明確支援圖片輸入 |

## 模型體驗

### 已發現的 MCP 工具

#### 模型看到的內容

初始發現成功後，每個已聲明的 MCP 工具都會顯示為名為 `mcp__<serverName>__<rawName>`（或其確定性規範化形式）的原生工具，並攜帶伺服器提供的描述和輸入 schema。成功的重新同步——包括自動重連後的同步——會替換整個世代；對外掛程式執行 dispose（資源釋放）或重連預算耗盡會移除該世代。

#### Token 影響

工具註冊期間，每次請求都會承擔資料相關的 schema 成本。重新同步會替換而非累積 schema，伺服器限定名稱也會為每個工具定義和呼叫增加 token。

#### KV Cache 影響

只要已發現工具集合及其 schema 不變，前綴就保持穩定。增加、移除、重新命名或更改工具的重新同步會替換定義，並可能使從第一個變化的 schema token 起的複用失效；復原了未變清單的重連會生成完全相同的定義，前綴保持穩定。

### 工具呼叫歷史與結果

#### 模型看到的內容

公開工具名稱和 JSON 參數會保留在 assistant 歷史中。執行區域性的規範值始終為程序化呼叫方和 Code Mode 保留完整 JSON MCP 塊及選填結構化內容。在 Native 上下文中，受支援的圖片塊會在確切路由能力得到證明後，按原始順序與文字一起持久投影；Code Mode 還會經外層 `run_code` 結果轉運這份已經結帳的豐富投影，而不改變規範綁定值。被拒絕的圖片、音訊、嵌入資源、資源連結和未知塊會繼續以有界文字診斷可見；MCP `isError` 會在持久化圖片前拒絕呼叫。

#### Token 影響

參數、對映後的文字和持久圖片引用會保留到壓縮（compaction）發生時。內聯 MCP base64 只存在於執行區域性的規範值中，絕不會複製進工作階段事件；提供方會從附件儲存讀取經過校驗的位元組。音訊和嵌入資源載荷仍不會進入模型上下文。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV-cache 條目失效。

## 已知限制與暫緩事項

- **只橋接 MCP 的工具能力**：資源和提示詞沒有 harness 消費介面，暫緩實作。
- **啟動逾時繼承自 MCP SDK**：DSH 尚未公開連線／發現逾時。每次 initialize 請求或分頁 `tools/list` 請求都使用 SDK 預設的 60 秒，因此在初始同步完成期間，無回應的 server 或 cursor chain 可能同時延遲啟用與 teardown。
- **重連在傳輸關閉時觸發**：崩潰的 stdio 子行程會觸發重連；Streamable HTTP 失敗透過每次請求以及 SDK 傳輸自身的 SSE（Server-Sent Events）流復原機制暴露，因此不可達的 HTTP 伺服器會按呼叫重試，而非由 supervisor 重新 spawn。
- **圖片是唯一的持久豐富結果橋接**：PNG、JPEG、WebP 和 GIF 可以在確切能力得到證明後進入 Native 上下文。音訊和嵌入資源載荷仍只存在於執行區域性，並配有明確診斷；資源連結只以文字保留名稱和 URI。
- **不強制執行不受支援的 MCP 輸出 schema**：已聲明 schema 使用 harness 子集之外的詞彙時，`structuredContent` 會回退到 `JsonValue`。
