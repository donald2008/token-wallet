# design-tokens 说明

本项目设计令牌（DTCG / W3C Design Tokens Format Module 规范），三层自上而下：

```
primitives.tokens.json   原始裸值：色板(含玻璃透明度)、8px 网格间距步进、字阶、圆角、阴影、动效时长、字体
semantic.tokens.json     语义层：引用 primitives，background/text/border/accent + 状态四色双 token(D-016)
components.tokens.json   组件级：引用 semantic，卡片/进度条/按钮/设置弹窗/托盘/玻璃等
tokens.css               生成的 CSS 变量映射（对照现有 --gap/--radius/--font-size 命名延续语义）
```

- 唯一数值来源，前端改动不得绕过本目录定义裸值。
- 状态色一律**双 token**：`--warn`(填充/图形) 与 `--warn-fg`(文字)，见 DECISIONS D-016。
- 间距/圆角遵守「8px 网格制」（margin/padding/gap/border-radius 必须 4/8 倍数，唯二例外=1px 边框、50% 圆角）。

## 验证方式（2026-09-03 实证通过）

用 W3C [terrazzo](https://terrazzo.app) CLI 校验结构 + 本目录自带脚本校验跨层 alias 解析：

```bash
# 1) terrazzo 结构/解析校验（需在装有 @terrazzo/cli 的临时目录，3 个 json 并列）
npx -y @terrazzo/cli check primitives.tokens.json semantic.tokens.json components.tokens.json

# 2) 跨层 alias 全量解析（无悬空、无环）—— 结果: 203 tokens / 123 refs / 0 errors
python3 validate_aliases.py
```

> 实测：`terrazzo check` 对全部三个文件输出 0 个解析/引用/循环错误；
> 仅剩 `valid-color/valid-dimension/valid-duration` 三类**迁移提示**（建议从字符串 hex 迁移到
> `{colorSpace, components}` / `{value, unit}` 新对象表示法），属可选演进项，非错误。
> 跨层 alias 引用（primitives→semantic→components 共 123 条）全部解析成功、无循环。
>
> `validate_aliases.py` 位于 `docs/design-tokens/`（本目录），可重复运行。

## 状态四色语义（双 token 映射到 theme.css）

| 语义 | 填充/图形 `--X` | 文字 `--X-fg`(dark) | 文字 `--X-fg`(light 压深) |
|---|---|---|---|
| ok 健康 | #22c55e | #4ade80 | #15803d |
| warn 预警 | #facc15 | #fde047 | #92600a |
| bad 危险 | #ef4444 | #f87171 | #b91c1c |
| unknown 未知 | #6b7280(dark)/#9ca3af(light) | #9ca3af | #6b7280 |