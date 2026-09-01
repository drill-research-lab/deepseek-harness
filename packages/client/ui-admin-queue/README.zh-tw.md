# @deepseek-ai/dsh-client-ui-admin-queue

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

管理排隊頁面是 DSH 設定中的原生分節,用於顯示內部 vLLM 准入佇列(`@deepseek-ai/dsh-llm-admission-queue`),並允許 admin 把等待中的請求拖成想要的執行順序。它留在既有設定對話框中。這個設定入口本身不會出現在非 admin 的瀏覽器裡:`apply()` 在連線建立時呼叫一次 `auth.me()`,只有回應回報 `isAdmin: true` 時才註冊 `settings.section` 佔位;這只是前端體驗層的便利,不是安全邊界——`queue.list` 與 `queue.reorder` 這兩個 RPC 各自在伺服器端獨立執行 admin 檢查,先於任何佇列存取。因此非 admin 直接呼叫這兩個方法(例如繞過這個 UI,從瀏覽器開發者工具發出請求)依然會收到 `forbidden` 錯誤,且是 HTTP 200 狀態下的業務錯誤(四象限 RPC 模型把業務錯誤放在 `RpcResult` 的 error 分支,從不映射成獨立的 HTTP 狀態碼)。

表格只有三欄——位置、使用者、狀態。執行中的請求(部署的 `limit` 大於 1 時可能不止一個)釘在最上面且沒有位置;等待中的請求接在後面,從 1 起算。`使用者` 是從 session header 解出的擁有者登入名(LDAP 帳號是 `ldap:` 登入名,本機帳號是註冊名)——只是身分,絕不含對話內容或 session id。每個等待列都可以拖曳(`@dnd-kit/sortable`,支援鍵盤);放開時把整份新的等待順序送給 `queue.reorder({ orderedQueueIds })`,執行中的列不能被拖、也不能被拖到其上。頁面每 `ADMIN_QUEUE_POLL_MS`(2 秒,與推論儀表板的預設節奏一致——`queue.list` 本身不攜帶伺服器建議的間隔)輪詢一次 `queue.list`;拖曳期間輪詢暫停、放開時恢復,避免過期快照把剛才的調整覆蓋掉。

## 模型體驗

無,因為此套件只為面向使用者的瀏覽器分節讀取與調整准入佇列的中繼資料,不會向模型請求或會話日誌添加任何內容。

#### KV 快取影響

無。除了可以設定等待順序之外,這個頁面純屬觀察性質,既不分配快取,也不會自行發出推論請求。

## 已知限制與後續工作

- **admin 判定是登入時的快照,並非即時** —— `isAdmin` 只在每次連線建立時判定一次(對應身分 cookie 本身在登入時對 LDAP `memberOf` 做的快照)。一個剛被加入或移出 admin 群組的使用者,在這個 UI 與對應 RPC 的這次連線範圍內,都會維持先前的判定,直到重新連線為止。這與身分鏈設計既有的已知限制一致,並非這個頁面獨有。
- **本機(非 LDAP)帳號永遠無法成為 admin** —— 無論該帳號本身權限為何,`dsh-auth-local` 的會話都無法看到管理排隊入口,因為 `AuthenticatedUser.isAdmin` 只會由 LDAP `memberOf` 鏈路設定。
- **除了稽核紀錄外沒有防濫用機制** —— 每次成功的 `queue.reorder` 都會寫入一筆稽核記錄(操作者身分、以及所設定的完整順序),但沒有任何機制限流或審查同一個 admin 的重複重排操作。查閱稽核記錄是一項人工的線下作業。
- **假設單一 admin 面向的行程** —— 准入佇列與整套 harness 一樣,假設一個 DSH Web 行程對應一個 vLLM 後端;這個頁面沒有跨行程彙總,只會顯示它所連線的那個行程的佇列。
- **v1 是輪詢,不是即時推送** —— 不像一般使用者的 `session/llm-queue` mux frame,這個頁面本身沒有推送通道;一位 admin 的重排操作,對另一位開啟中的 admin 頁面來說,要到下一次輪詢(最多間隔 `ADMIN_QUEUE_POLL_MS`)才會可見。把 `queue.onChange` 接進專屬的 admin mux 廣播留待後續。
- **執行中的請求無法被重排** —— `queue.reorder` 只影響仍在等待的條目(與 `AdmissionQueue.reorder` 本身的約定一致);這裡沒有針對並發上限或已獲准入請求的控制項。
- **手動順序只存在於行程內** —— 它只在准入佇列的記憶體裡;Web 行程重啟會遺失,等待佇列回到 FIFO。
