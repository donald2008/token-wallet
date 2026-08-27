## Variant: 紧凑作战室 (compact-ops)

### Design stance
信息密度优先: 所有窗口用量压进带文字的进度条, 一屏装下全部 provider。

### Key choices
- Layout: 单列卡片流, 卡片按健康度排序(最坏置顶)
- Typography: UI 无衬线 + 等宽数字
- Color: 四色语义(绿/黄/红/灰), 进度条压字
- Interaction: 本地 Agent 区折叠展开; 深/浅主题切换

### Trade-offs
- Strong at: 扫读效率最高, 卡片数量多时扩展性最好, 360px 窄面板利用率高
- Weak at: 视觉平淡, "仪表盘感"弱

### Best for
默认主力模板(bars): 天天盯着用的运维场景
