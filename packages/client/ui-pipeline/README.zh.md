# @deepseek-ai/dsh-client-ui-pipeline

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

流水线表面插件（浏览器半部）：侧栏 `sidebar.pipelines` 区块（会话浏览器下方的功能导航座位，由 ui-sidebar 的外壳契约持有）与一个 `shell.overlay` 全窗口编辑器覆盖层（order 20）。两个入口共享一个 root 作用域 store——打开中的流水线 id——在 apply 时创建，身份跟随插件 fiber；并共享一个面向生成的 `pipelines` Remote 命名空间（`list`、`get`、`save`、`delete`、`setEnabled`、`triggerNow`、`runs`、`run`）的注入面。导航区块列出每条流水线的实时状态、失败连击徽章，以及每行的暂停/恢复开关（`setEnabled` 之后重新读取列表）；点击流水线写入 store、打开覆盖层并请求侧栏展开。没有打开的流水线时覆盖层不渲染任何内容；打开后显示页头（名称、立即运行、关闭）、只读 DAG 画布——定义不携带位置，分层布局由 elkjs 计算——以及运行列表。立即运行会等待 `triggerNow` 完成并刷新运行列表。

`/client` 导出插件体（`apply`/`inject`）、共享 store 工厂（`createPipelineUiStore`）、纯函数 `layoutDag` 及其 `LaidOutNode` 形状，以及注入/prop 类型词汇。画布是 `@xyflow/react` 之上的表现组件，处于只读模式（不可拖拽、不可连线、不持久化位置）。

## Model Experience

无。表面通过宿主的 `pipelines` Remote 命名空间读取流水线定义与运行记录，不添加任何提示内容、会话事件或投影。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- **模板画廊仅覆盖 Scheduled Search** —— 创建视图承载 Scheduled Search 表单（名称、检索词、cron、时区、抓取上限、LLM 摘要开关）与粘贴 JSON 导入；更多模板随后续切片交付。
- **检查器仅支持选中** —— 点击画布节点会高亮它，但检查器的各窗格（每节点的配置 / 输入 / 输出）与溯源视图随检查器切片交付。
- **LLM 节点依赖引擎配置** —— 编辑器无法按节点选择模型；LLM 节点依赖引擎的 `llmProvider`/`llmModel` 默认值，否则以 `LLM_NODE_UNCONFIGURED` 大声失败。
