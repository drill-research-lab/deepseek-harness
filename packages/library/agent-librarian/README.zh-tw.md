# @deepseek-ai/dsh-agent-librarian

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Librarian subagent 供應者：在 `ctx.subagents` 上註冊 `librarian`，每次委派都以全新的行程內子代理啟動，帶著透過 `library_*` 工具工作的 librarian 角色 — 用 `library_structure` 探索（入庫時索引供應的大綱與摘要）、用 `library_read` 讀取原文字句、用 `library_ingest` 歸檔素材，並根據讀到的內容自行作答、附行內 `[name]` 引用（絕不回頭呼叫 `library_ask`，那是呼叫者進入它的入口：`library_ask` 委派到「這裡」，子代理若再提問回去就會遞迴）。一般 agent（Chat 協調者）把知識庫工作委派給 `librarian`，而不是把整份文件拉進自己的脈絡，符合 Drill 規格的 orchestrator／librarian 分工。角色與供應者名稱是部署設定。

## 模型體驗

供應者本身不給父代理增加工具或提示詞文字；被委派的子代理以強制的 librarian 角色（前置於任何呼叫者角色）執行，外加委派要求的工具過濾。

#### KV 快取影響

對父代理的提示詞前綴無影響；每個子代理都是全新脈絡。

## 已知限制與延後工作

- 子代理是全新脈絡（`inheritsParentContext: false`）；Drill 規格的 `shared-project` 脈絡模式延後到 subagent 接縫。
- 還沒有專屬的 Web UI preset 列；委派經標準 subagent 工具進行。
