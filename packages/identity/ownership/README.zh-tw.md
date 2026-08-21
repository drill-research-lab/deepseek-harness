# @deepseek-ai/dsh-ownership

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

定義 Host 持久化共享的可信 ownership 型別：`OwnerPrincipal`、`OwnershipService`、`UserHome` 和 `UserHomePath`。Request principal 來自已經驗證的 `AuthService` 非同步作用域；background principal 只接受從可信持久化中讀取、已經 branded 的 `AuthenticatedUserId`。兩種 principal 都不攜帶使用者名稱、cookie、密碼或閘道憑據。

`UserHome.path()` 接受逐個提供的相對路徑元件，並拒絕空值、絕對路徑、點、遍歷、NUL、斜線和反斜線。此詞法驗證防止呼叫端控制的路徑語法逃離設定的根目錄，但不防止符號連結替換或 TOCTOU 競態；檔案提供方必須說明並執行更強的操作級保證。

## Model Experience

無，因為 ownership identity 和 Host 路徑不會進入模型輸入。

#### KV Cache effect

無；此套件不組裝提供方請求。

## Known Limitations and Deferred Work

- PR A1 只建立 ownership foundation；資源遷移、跨使用者 API authorization、生產 multi-user isolation 和 sandbox isolation 仍屬後續工作。
