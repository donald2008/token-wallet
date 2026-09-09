# 人工审核意见 — t_fe30f3c9

reviewer: njbx02 (default 老大人工终审, run 853, execution lens)
verdict: changes_requested   # 3 BLOCKING + 1 WARNING + 1 SUGGESTION

## 审核范围与独立复验（本机重跑, 不采信 worker/auto-reviewer 声明）

- Git 三查: 干净 clone（/tmp, ext4）→ origin/master HEAD=3943335（含本卡 3 commit edc5206/33c9761/8f1d90a + 兄弟卡截图 3943335 + 构建卡 855ab7c）; base 89b6ae2 ✓; ls-remote origin master 一致 ✓
- diff 范围: 89b6ae2..8f1d90a = 7 文件全 docs（README×2 / DECISIONS / DESIGN / RELEASE / USER_GUIDE / frontend-AGENTS）+532/-101，零 packages/ 越界 ✓（scope 合规）
- 命令实测（README 原文命令, node v22.22.2 + pnpm 9.15.0）: `corepack pnpm install --frozen-lockfile` → `corepack pnpm -C packages/core build` → core/app typecheck 全 exit 0 ✓
- 截图取证: panel-{dark,light,glass}.png 真实存在, 720×1440（=2x 360×720）, PIL 像素统计三主题分明（dark mean≈32 / light≈245 / glass≈29, 均 2200+ 唯一色）; README 引用三张均可解析 ✓（兄弟卡 3943335 补齐）
- D-048~D-053 六条齐（编号/日期/标题/理由四要素）✓；USER_GUIDE 8 节齐 ✓；provider-card-layouts 残留引用 0 ✓；凭据扫描（sk-/Bearer/api_key）0 命中 ✓
- 结论: 结构/命令/截图全部达标; **内容层存在 3 处与代码事实矛盾的硬伤**——auto-review 的关键词 grep 法只验「有没有」不验「对不对」，被以下错误穿透

## 修改项

1. [README.md:136,147 + README.en.md:144,156 + docs/USER_GUIDE.md:13] BLOCKING — **内网 IP 回归公共 README（违反 2026-09-01 用户铁律 + 与代码事实矛盾）**
   - 证据: 基线 89b6ae2 的 README 是干净的——唯一直链 = gitee stable, 自动更新文案 =「应用内置自动更新（v0.2.4 起走 gitee 公共更新源）」; 本卡 diff 重新引入 `http://10.200.1.88:8889/token-wallet_setup.exe`（置于 gitee 直链之前, 标「自家托管开发版」）并把自动更新描述改成「下载清单托管于 `http://10.200.1.88:8889/token-wallet/`」——后者是事实错误: packages/app/package.json `publish.url` = `https://gitee.com/ITEater/token-wallet/releases/download/stable/`（9/2 用户拍板「都走公共 url」, 一次定死）。USER_GUIDE.md 为新增文件, §1.1 同样带 8889 开发版直链
   - 判定: 用户 2026-09-01 硬纠正「开源 README 禁内网路径——用户看第一眼就抓」; 本卡是把干净文档改回内网泄露态 + 写错自动更新源, docs-only 卡的核心交付就是内容正确性, 此条违反
   - 要求: 删除 README/README.en/USER_GUIDE 中全部 `10.200.1.88`/`:8889` 链接; 自动更新描述恢复「v0.2.4 起走 gitee 公共更新源」语义; 开发版通道如需提及只写「内部开发通道」不带 URL; 中英同步

2. [docs/RELEASE.md §1① 新增「已知遗留」段（L15-21）] BLOCKING — **与仓库事实矛盾（t_362b98bc 引用过时, 未核对现状）**
   - 证据: 该段称「version 至今仍写 0.1.0」「任何 tag 出包原始产物都叫 token-wallet_0.1.0_setup.exe」「应用内版本仍显示 0.1.0」——实测 packages/app/package.json `version=0.2.8`（基线 89b6ae2=bump 0.2.8 即如此）; D-046 版本纪律自 v0.2.0 起一直执行（5ad6952=0.2.0 / a940470=0.2.4 / 07ddc13=0.2.7 / 89b6ae2=0.2.8）, electron-builder 产物名应为 `token-wallet_0.2.8_setup.exe`
   - 判定: 发版手册教未来操作者按错误前提手动重命名产物, 是「防误导」任务的直接反面
   - 要求: 删除该段; 连带核对 §1③「手动重命名为 token-wallet_v<X.Y.Z>_setup.exe」与 gitee stable 固定文件名（`token-wallet_setup.exe`）流程一致

3. [docs/RELEASE.md L5 + §2 L56 + §4 L72-74] BLOCKING — **更新源/分发渠道描述停在 9/2 之前（任务#2「过期文档盘点」应覆盖未覆盖）**
   - 证据: L5「托管于 njbx02 nginx `http://10.200.1.88:8889/token-wallet/`」; §2「更新源硬编码 build.publish（generic 8889）」; §4「gitee release 挂包（P4 可选, 主分发=8889）」「当前唯一分发渠道是 §1-③ 托管目录」——全部与现状矛盾: publish.url=gitee stable 且自 v0.2.4 起 gitee stable 是公共主渠道、每次发版必做（删旧 3 附件→传新 3 件→匿名 curl 验证）, 8889 已降级为内部开发通道
   - 判定: 按本手册发版会跳过公共更新源覆盖（v0.2.5 假阳性教训: API 操作成功≠用户下载路径已更新）; 卡片任务#2 明确要求盘出这类「引用已废弃机制的文档」, 本卡只改了标题/验收清单, 未盘渠道拓扑
   - 要求: 改写 §2/§4: publish.url=gitee stable（一次定死, 开源前后同 URL）; 发版五步加入 gitee stable 必做子步（删旧 3 附件 → 传新 3 件, access_token 走 `-F "access_token=$TOKEN"` form 字段 → 匿名 curl 验证 latest.yml version + exe Content-Length 两处都验）; 8889 改写为内部开发通道; 内网 IP 按公共仓库纪律处理

## WARNING（放行但本轮建议一并补）

4. [docs/DECISIONS.md] **9/2 开源 + 更新源切 gitee stable 无决策记录**——D-046 仍是「自家 nginx 8889 托管」的最新决策, 与代码/README 现状矛盾的根因就在此。建议本轮追加 D-054（2026-09-02）: 开源 + publish.url 切 gitee stable + 「开源 README 禁内网路径」用户铁律正式入决策; 或在 D-046 行尾标注「更新源已于 9/2 切换, 见 D-054」。不阻塞, 但这是防再漂移的最小闭环

## SUGGESTION

5. [docs/RELEASE.md L7] 「当前里程碑 = v0.2.8（master HEAD `89b6ae2`）」——89b6ae2 是版本基线 commit 而非 master HEAD（push 时 HEAD=8f1d90a, 现 3943335）。建议改「版本基线 `89b6ae2`」, 防后续操作者误以为 master 停在旧 commit
