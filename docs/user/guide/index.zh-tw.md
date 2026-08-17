# 使用 Web UI

[English](index.md) | [简体中文](index.zh.md) | 繁體中文

請先按照[根目錄 README](../../../README.md#run) 中的說明啟動 Web UI；命令會列印其訪問地址。本指南從伺服器已經執行的狀態開始。`dsh` 行程會把啟動時所在的目錄作為預設檔案系統位置；全新的 Web UI 則不會選中任何工作區，你需要新增一個工作區。

## 設定模型

打開**設定 → 模型**，輸入 [DeepSeek API 金鑰](https://platform.deepseek.com/)並保存。模型路由會立即可用，不需要重新啟動伺服器。

[模型設定指南](./providers.md)介紹其他提供方和自訂 OpenAI 相容端點。

## 選擇工作區

點擊**選擇工作區**，新增啟動 `dsh` 時所在的項目目錄，然後選中它。選中工作區前，工作階段輸入框不可用。

## 執行任務

啟動一個工作階段並行送：

> Summarize this repository and identify its main packages.

Agent（代理）可以讀取和編輯工作區文件、執行命令、委派工作並維護計畫。如果根據當前權限策略，某項操作需要審批，Web UI 會先詢問你。

## 繼續使用

- [設定模型](./providers.md)
- [使用 Python SDK](./python-sdk.md)
- [使用其他 CLI 模式](../../../apps/cli/README.md)
- [開發外掛程式](../develop/basic/)
