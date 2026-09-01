# @deepseek-ai/dsh-client-ui-admin-queue

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

管理排队页面是 DSH 设置中的原生分节,用于显示内部 vLLM 准入队列(`@deepseek-ai/dsh-llm-admission-queue`),并允许 admin 把等待中的请求拖成想要的运行顺序。它留在现有设置对话框中。这个设置入口本身不会出现在非 admin 的浏览器里:`apply()` 在连接建立时呼叫一次 `auth.me()`,只有回应报告 `isAdmin: true` 时才注册 `settings.section` 占位;这只是前端体验层的便利,不是安全边界——`queue.list` 与 `queue.reorder` 这两个 RPC 各自在服务器端独立执行 admin 检查,先于任何队列存取。因此非 admin 直接呼叫这两个方法(例如绕过这个 UI,从浏览器开发者工具发出请求)依然会收到 `forbidden` 错误,且是 HTTP 200 状态下的业务错误(四象限 RPC 模型把业务错误放在 `RpcResult` 的 error 分支,从不映射成独立的 HTTP 状态码)。

表格只有三栏——位置、使用者、状态。运行中的请求(部署的 `limit` 大于 1 时可能不止一个)钉在最上面且没有位置;等待中的请求接在后面,从 1 起算。`使用者` 是从 session header 解出的擁有者登入名(LDAP 帐号是 `ldap:` 登入名,本机帐号是註冊名)——只是身分,绝不含对话内容或 session id。每个等待列都可以拖动(`@dnd-kit/sortable`,支援键盘);放开时把整份新的等待顺序送给 `queue.reorder({ orderedQueueIds })`,运行中的列不能被拖、也不能被拖到其上。页面每 `ADMIN_QUEUE_POLL_MS`(2 秒,与推理仪表盘的默认节奏一致——`queue.list` 本身不携带服务器建议的间隔)轮询一次 `queue.list`;拖动期间轮询暂停、放开时恢复,避免过期快照把刚才的调整覆盖掉。

## 模型体验

无,因为此包只为面向用户的浏览器分节读取与调整准入队列的元数据,不会向模型请求或会话日志添加任何内容。

#### KV 缓存影响

无。除了可以设定等待顺序之外,这个页面纯属观察性质,既不分配缓存,也不会自行发出推理请求。

## 已知限制与后续工作

- **admin 判定是登入时的快照,并非即时** —— `isAdmin` 只在每次连接建立时判定一次(对应身份 cookie 本身在登入时对 LDAP `memberOf` 做的快照)。一个刚被加入或移出 admin 群组的使用者,在这个 UI 与对应 RPC 的这次连接范围内,都会维持之前的判定,直到重新连线为止。这与身份链设计既有的已知限制一致,并非这个页面独有。
- **本机(非 LDAP)帐号永远无法成为 admin** —— 无论该帐号本身权限为何,`dsh-auth-local` 的会话都无法看到管理排队入口,因为 `AuthenticatedUser.isAdmin` 只会由 LDAP `memberOf` 链路设定。
- **除了稽核纪录外没有防滥用机制** —— 每次成功的 `queue.reorder` 都会写入一笔稽核记录(操作者身份、以及所设定的完整顺序),但没有任何机制限流或审查同一个 admin 的重复重排操作。查阅稽核记录是一项人工的线下作业。
- **假设单一 admin 面向的进程** —— 准入队列与整套 harness 一样,假设一个 DSH Web 进程对应一个 vLLM 后端;这个页面没有跨进程汇总,只会显示它所连线的那个进程的队列。
- **v1 是轮询,不是即时推送** —— 不像一般使用者的 `session/llm-queue` mux frame,这个页面本身没有推送通道;一位 admin 的重排操作,对另一位打开中的 admin 页面来说,要到下一次轮询(最多间隔 `ADMIN_QUEUE_POLL_MS`)才会可见。把 `queue.onChange` 接进专属的 admin mux 广播留待后续。
- **运行中的请求无法被重排** —— `queue.reorder` 只影响仍在等待的条目(与 `AdmissionQueue.reorder` 本身的约定一致);这里没有针对并发上限或已获准入请求的控制项。
- **手动顺序只存在于进程内** —— 它只在准入队列的内存里;Web 进程重启会丢失,等待队列回到 FIFO。
