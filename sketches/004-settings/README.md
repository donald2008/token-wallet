## Variant: 设置页 (settings)

### Design stance
表单密集型界面的收敛设计: 左导航分组 + 右侧内容, Provider 管理为核心区, 添加流程走
"通道选择弹层(logo 网格) → 动态参数表单(含测试连接) → 保存"。

### Key choices
- Layout: 660px 窗口, 左 150px 导航(Provider/外观/采集/通知/数据/关于), 右侧内容区
- Provider 实例卡: logo + 名称 + 原型/轮询 + 实时状态 + 测试/编辑
- 添加流程: 通道选择弹层 → params_schema 动态表单(secret 密码框不回显) → 测试连接 → 保存
- 通知页为 P3 占位(开关默认关, 阈值置灰)
- Interaction: 导航切换 / 主题切换 / 弹层流程 / 测试连接结果 / toast

### Trade-offs
- Strong at: 录入路径完整可点; 与 DESIGN.md §5 通道模型一一对应
- Weak at: 单变体(设置页信息架构比视觉风格更关键, 视觉跟随主面板主题)

### Best for
评审录入交互闭环(选通道→填参数→测试→保存)与设置项分组是否合理
