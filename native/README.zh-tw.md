# native/

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

與 DeepSeek Harness 一同維護的原生原始碼和公開包。[`landlock-run/`](landlock-run/README.md) 負責檔案系統圍堵，[`pid-isolate-run/`](pid-isolate-run/README.md) 負責 Linux PID/mount namespace 初始化與 capability（能力）移除。

## Workspace 與發布邊界

兩個原生包家族都屬於倉庫根 pnpm workspace，並共用根鎖定檔。開發和 CI 中的 harness 消費端直接使用目前 workspace 的入口包，因此 launcher 協議變更與消費端更新會一起測試。

專用工作流程會在每個受支援架構上建置並測試各包家族。發布工作流程匯集原生產物、驗證 npm tarball，並可選擇為每個家族發布一個同步版本。入口包把平臺包宣告為 npm 選填相依性，因此 npm 只安裝與作業系統和 CPU 匹配的包。PID helper 還需要在安裝後執行 `setcap cap_sys_admin,cap_setpcap+ep`，因為 npm 不保留 file capabilities。
