## Variant: 终端账本 (terminal-ledger)

### Design stance
极客终端风: 全等宽字体, 字符画进度条(████░░), sparkline 趋势折线, 表格账本。

### Key choices
- Layout: 单列, 类终端输出, provider 名左侧带 16px 品牌色 logo 块
- Typography: 全等宽, 字符进度条
- Color: 终端绿系深色主题 + 四色语义
- Interaction: 深/浅主题切换; sparkline 展示趋势概念(正式版由 Chart.js 承担)

### Trade-offs
- Strong at: 趋势 sparkline 自然融入; 开发者审美; 字符条在任何宽度下不破版
- Weak at: 字符进度条精度低(10 格); 非终端审美用户可能觉得简陋

### Best for
极客向主题选项; 验证 sparkline 趋势的展示价值
