# @deepseek-ai/dsh-host-directory-picker

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

web GUI 宿主的工作區目錄選擇是一項能力 seam。抽象的 `DirectoryPicker` 服務（`ctx.directoryPicker`）是其 Service Definition。該服務只提供一個方法：`capability()`，它返回一個可辨識聯合類型，說明操作者如何選擇目錄。後端之間的使用者互動不同，不只是實作不同：`{ kind: 'native', pick(signal) }` 在宿主螢幕上打開一個原生 OS 選擇器（[`-native`](../directory-picker-native/README.md)）；`{ kind: 'browse', list(path?), createDirectory(path, name) }` 提供應用內瀏覽器使用的列舉與建立操作，也能服務於無法訪問 OS 對話框的遠端用戶端（[`-browse`](../directory-picker-browse/README.md)）。消費端按 `capability().kind` 分支；聯合類型由可合併擴充的 `DirectoryPickerCapabilities` 對映派生，新後端透過聲明合併在其中加入自己的變體。遇到未知 kind 時，消費端會隱藏目錄選擇入口，而不是失敗。能力對象在服務生命週期內必須保持穩定。每種互動都由一個 Host 後端和 ui-workspace directory-flow slot 中匹配的 Client 介面組成。需要在執行時期選擇互動的組合掛載 [`-auto`](../directory-picker-auto/README.md)，它在啟動時檢查一次宿主情況並掛載兩行；固定互動的組合則直接掛載選定的一對。

瀏覽原語失敗時會拋出帶類型的 `DirectoryPickerError`（`directory-unreadable`／`directory-outside-owner-root`／`directory-exists`／`directory-create-failed`，各自攜帶出錯對象的 `path`），消費閘道將其 1:1 對映為協定錯誤碼。`DirectoryEntry` 行攜帶宿主判定的 `hidden` 標志（POSIX 點前綴約定），展示策略留在用戶端；`DirectoryListing.home` 是當前請求所有者的規範根目錄，`crumbs` 只包含該根目錄及其後代。設計依據、與 `ctx.fs` 的切分、策略裁決見 [目錄選擇能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-directory-picker-capability-seam.md)。

## 模型體驗

無。該 seam 服務於 GUI 宿主的目錄選擇；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **不支援多根目錄**——每個請求 principal 只有一個規範瀏覽根目錄與一條祖先鏈；約定不公開其他根目錄或 Windows 盤符枚舉。
