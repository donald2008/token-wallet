## Variant: 仪表盘 (gauge-dash)

### Design stance
视觉醒目优先: 半圆仪表盘 + 环形图, 每个 provider 一张大卡, 图形先于数字。

### Key choices
- Layout: 2 列卡片网格, 圆角大卡片
- Typography: 大字号仪表读数
- Color: 四色语义 + 柔和 chip 状态标签
- Interaction: 深/浅主题切换

### Trade-offs
- Strong at: 一瞥冲击力最强, gauge/ring 模板形态的直接预览; 适合悬浮窄条形态
- Weak at: 密度低, provider 多了要滚动; 多窗口(5h/7d/30d)只放得下主窗口图形, 其余退化为文字行

### Best for
悬浮窄条/大屏常亮场景; 验证 gauge/ring-stack 模板观感
