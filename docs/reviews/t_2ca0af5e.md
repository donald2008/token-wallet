# 人工审核意见 — t_2ca0af5e

reviewer: njbx02 (default 老大人工终审, run 770)
verdict: changes_requested   # 1 BLOCKING(标题截断, 转派修复子卡 t_xxx) + 3 裁决 APPROVE + 2 WARNING 记档

## 审核范围与独立复验（均本机重跑, 不采信 worker/auto-reviewer 声明）

- Git 三查: 目标 commit a9029b2 位于 origin/feat/theme-glass 链 (b88316b → a9029b2 → 279858d → d304801), 已 push 核对 ✓; 本地 HEAD=b88316b(落后远端两 commit, 本卡只审 a9029b2^..a9029b2)
- diff 范围: 28 文件 +574/-912 (SideBar 删 118 行 / BottomBar 新 57 / TitleBar +67 / App +76 / health/persist 归一化 / e2e 全量同步), 与声明 scope 一致
- typecheck EXIT 0 / vitest EXIT 0 / build EXIT 0 / **e2e 85 passed (44.9s) 独立重跑全绿**
- 截图取证: 4 张 (tw-layout-{dark,light,glass,newfirst}.png, 360×640) PIL 像素测量 + vision 复核

## 裁决（老三遗留 3 个待拍板点）

### 1. 底边栏形态（高~36px 两按钮左右分布 icon+文字）— ✅ APPROVE
- 实测 (PIL+vision): 栏高≈36px (按钮 28px + 上下 padding 4px), 两钮 space-between 左右分布, 左「＋ 添加 Provider」右「⚙ 设置」, 1px 上缘 --border 分隔, ghost 钮 (hover 才浮底), 四张截图全主题无截断无溢出
- 符合「桌面部件 = 细条+层级+克制」: 36px 一条栏低调不抢戏; 添加=主 CTA 带字可发现, 设置=低频但带字不重 (栏内仅两动作, 空间充裕); 8px 网格合规 (padding 4/8、gap 8、按钮高 28=4×7)
- 操作分区语义 (D-038 延续) 表达正确: 标题栏=窗口/全局态, 底边栏=低频全局动作, 卡内=实例动作

### 2. manual 无 order 时尾部按名称正排 vs 完全按添加序 — ✅ 定名称正排 (现实现正确)
- 确定性: Intl.Collator("zh",{numeric:true}) 钉死, 跨机/重启稳定 (t_6c6dd54f 教训已守); 添加序依赖 instances.yaml 先后, 对用户不可见且不可预期
- 连续性: 与旧缺省「名称正排」视觉一致, 存量用户升级零跳变
- 实际尾部出现场景有限 (无 order 全量 = 新品/从未拖拽; 外部编辑实例), 名称正排是最稳兜底; 新 provider 置顶由 onProviderSaved prepend order 保证 (已在 order 内, 不进尾部)
- D-039 交集语义保留 (幽灵 id 忽略、实例集合=真相源), 迁移归一化 (旧 name/urgency→manual, order 保留) unit+e2e 双覆盖

### 3. i18n 排序键删除 — ✅ 接受
- sortName/sortUrgency/sortManual/sortAsc/sortDesc zh+en 全删, grep 零悬空引用 (src+e2e)
- sortHint 文案已重写为「拖拽即排序 + 新添加自动第一位」用户语言; themeHint 也同步修正 (左下角→标题栏, 好)
- 清理旧物纪律符合「清旧物不留尾巴」; 唯一残留 = side.* i18n key 命名 (side.aria="功能底栏" / side.refresh 被标题栏复用) — 纯命名洁癖, 不阻塞

## 修改项

1. [packages/app/src/components/TitleBar.tsx + app.css .titlebar/.app-title] BLOCKING — **360px 生产宽度下标题默认态截断 "token-wall…"**
   - 证据: 4 张交付截图全主题全中 (vision 2 轮 + PIL 实测: 文本右缘 x≈113, 省略号 x≈157, 刷新钮 x≈198)
   - 归因: 本卡刷新/主题迁入使标题栏 3 钮→5 钮, 固定预算 238px (padding 24 + 状态点 8 + gap 8×7 + 钮 30×5·), 标题+spacer 仅剩 ~106px → 截断 ~10-20px, 属「差几像素」
   - 判定: t_2ac39613 允许截断是**拥挤兜底语义**, 本卡把它变成了**默认态常态**——桌面部件每启动必见自家名字被砍, 违反成品质量标准 (用户抓 UI 亚像素问题的记录: 蓝底 10px/授权卡截断)
   - 要求(修复子卡承接): ①360px 预算内放全标题 (方向: gap 收敛 / 按钮 30→28 / 标题字号-1, 保持 4/8 网格与铁律, worker 自选) ②**补 e2e 断言「完整标题可见」**——现有 360px 测试只断单行不换行, toHaveText 对 CSS ellipsis 无效 (DOM 文本仍完整), 这是本轮截断漏网的契约缺口 ③复验截图必须 **360×600 生产规格** (交付截图用 640 高, 比生产多 40px, 高度维度不可信)
   - 修复前不得发版 (feat/theme-glass 合入/打包均需此修复先行)

## WARNING（放行但记录, 不阻塞）

1. **窗口高度 600→720 未落地** (main.ts:155 仍 600): 9/4 拍板记录含此条, 但意图是「配 hero 汇总区」, hero 未建, 本卡 body 也未列 → 放行; **归属: hero 落位卡必须显式承接, 不得丢失** (记档在 token-wallet skill)
2. Kimi 卡第二配额行在截图滚动边界被裁: 判定为截图滚动位置伪影 (内容可滚, 非溢出), a9029b2 未动卡片域 → 非本卡回归; 修复子卡复验时滚动后顺带确认
3. (SUGGESTION) e2e/capture-*.cjs 4 个产图脚本 + packages/core/src/channels/.hermes-tmp.uoDZDV 未跟踪 — 建议脚本入库或 gitignore, tmp 清理

## 结论

三个拍板需求 (侧栏移除/手动排序/新 provider 置顶) 实现正确、证据充分: unshift+prepend 双保险、重启持久化 e2e (Zeta 新实例首位, 名称正排本应最后——断言设计得好)、迁移归一化、残引清零、拖拽 order 交集语义保留。6 维设计原则检查全 PASS (职责分明/契约同步/清理彻底/迁移宽容/确定性排序)。**唯一实质问题 = 标题截断默认态**, 修复量极小 (几像素预算), 但属用户可见的默认态视觉缺陷, 按「成品质量」标准打回, 转派修复子卡收口。