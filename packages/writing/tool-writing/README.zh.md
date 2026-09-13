# @deepseek-ai/dsh-tool-writing

[English](README.md) | 简体中文

面向模型的写作工具，为写作 agent 闭合 写入 → 编译 → 修复 循环，后端由 `@deepseek-ai/dsh-writing`（`ctx.reports`）与 `@deepseek-ai/dsh-writing-compile`（`ctx.latexCompile`）提供。

注册在 `ctx.tools` 上的工具：

- `report_create` — 由标题、模板与可选源码创建报告；其源码存放在会话工作区下以时间戳命名的目录（`writing/<yyyymmddhhmmss>/main.tex`）中，传入空 `source` 会得到空白文档。
- `report_write` — 替换当前全部源码（自动保存；不生成快照）。
- `report_read` — 读取当前源码，按 `maxReadChars` 截断。
- `report_compile` — 编译当前源码，返回诊断，并在成功时自动生成版本快照。
- `report_versions` — 由新到旧列出各版本快照。
- `report_restore` — 将报告恢复到较早的快照。

## Configuration

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxReadChars` | `20000` | `report_read` 返回的报告源码上限。 |
| `maxDiagnostics` | `50` | `report_compile` 返回的诊断上限。 |

## Model Experience

这些工具是写作能力面向模型的表层。每次调用都由工具注册表记录，报告内容与编译诊断即写作 agent 所见。报告注册表本身（报告项目、快照、模板）不是模型输入。

`tool:writing` 系统提示词分区把这些工具作为 LaTeX 写作的入口：要求创建、编辑或编译 LaTeX 文件、文档或报告（包括空白文件）的请求会使用 `report_create` 及其他 `report_*` 工具，而不是通用的 `write`/`edit` 工具，该分区也点明了以时间戳命名的源码目录。

#### KV Cache effect

无；这些工具不组装任何提供方请求。

## Known Limitations and Deferred Work

- `report_write` 仅支持整体源码替换；段落级编辑与差分感知的部分更新已推迟。
- 编译诊断来自编译服务的日志解析器；texlab LSP 诊断是另一个已推迟的能力面。
- 这些工具的无密钥快照记录覆盖尚未接通；在加入组装后以快照钉住模型可见文本。
