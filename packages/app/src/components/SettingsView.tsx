import { useEffect, useState } from "react";
import type { ThemeMode } from "../theme";
import type { SortConfig, SortDir, SortKey } from "../health";
import { getStoragePaths, getLaunchAtLogin, setLaunchAtLogin, type StoragePaths } from "../ipc";
import type { InstanceConfig } from "../instances/schema";
import { getSharedKeyring, getSharedStore, useInstances } from "../instances/store";
import type { ChannelDescriptor } from "@token-wallet/core/channels";
import { ChannelTree } from "./ChannelTree";
import { DynamicForm } from "./DynamicForm";

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

interface Props {
  themeMode: ThemeMode;
  onThemeMode: (m: ThemeMode) => void;
  /** 卡间排序配置(#829 R1): key(名称|紧要度)×dir(正排|倒排), 由 App 持有并持久化 */
  sortConfig: SortConfig;
  onSortConfig: (c: SortConfig) => void;
  onBack: () => void;
  /** page = 首开向导页内导航(D-021); modal = 设置弹窗(P0-6), 头部渲染 × 关闭 */
  variant?: "page" | "modal";
  /** 首开引导(D-021): 从空态"添加 Provider"进入时直接开添加流程 */
  initialStep?: "overview" | "add-channel" | "fill-form";
}

const SORT_KEY_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "name", label: "名称" },
  { id: "urgency", label: "紧要度" },
];

const SORT_DIR_OPTIONS: { id: SortDir; label: string }[] = [
  { id: "asc", label: "正排" },
  { id: "desc", label: "倒排" },
];

/**
 * 设置页(D-017/D-019/D-021/D-024/D-025/D-026):
 * - 首开引导: 无实例时展示树形通道选择器引导添加第一个 provider(§10)
 * - 实例列表: 添加/列出/删除(删除同步清钥匙串条目,D-029)
 * - 添加流程: 树形通道选择器 → 动态表单 → 测试连接 → 保存
 * - 存储路径显示(D-019): 运行时解析
 * - 开机自启开关(D-024): 默认关
 * - 排序配置(#829 R1): 键(名称/紧要度)×方向(正排/倒排)两正交控件, 缺省名称正排
 * - 布局(#829 R3): .settings-head 固定不滚动, 滚动只发生在 .settings-body 内容区
 */
export function SettingsView({ themeMode, onThemeMode, sortConfig, onSortConfig, onBack, variant = "page", initialStep = "overview" }: Props) {
  const instances = useInstances();
  const [step, setStep] = useState<"overview" | "add-channel" | "fill-form">(initialStep);
  const [selectedChannel, setSelectedChannel] = useState<ChannelDescriptor | null>(null);
  const [storagePaths, setStoragePaths] = useState<StoragePaths | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // 存储路径(D-019) + 开机自启(D-024), 默认关
  useEffect(() => {
    void getStoragePaths().then(setStoragePaths);
    void getLaunchAtLogin().then(setAutoStart);
  }, []);

  const isFirstRun = instances.length === 0;

  const startAdd = () => {
    setSelectedChannel(null);
    setStep("add-channel");
  };

  const onPickChannel = (d: ChannelDescriptor) => {
    setSelectedChannel(d);
    setStep("fill-form");
  };

  const onSaved = () => {
    setStep("overview");
    setSelectedChannel(null);
  };

  const onDelete = (id: string) => {
    // 删除实例同步清钥匙串条目(D-029 由 store.remove 执行)
    getSharedStore().remove(id, getSharedKeyring());
  };

  return (
    <div className="settings-view" data-testid="settings-view">
      <div className="settings-head">
        <h3>设置</h3>
        {variant === "modal" ? (
          <button
            type="button"
            className="btn btn-icon"
            data-testid="settings-close"
            aria-label="关闭设置"
            onClick={onBack}
          >
            ×
          </button>
        ) : (
          <button type="button" className="btn" data-testid="settings-back" onClick={onBack}>
            ← 返回
          </button>
        )}
      </div>

      {/* #829 R3: 头部(.settings-head)固定不滚, 滚动只发生在头下方 .settings-body 内容区;
          modal/page 两 variant 同结构生效 */}
      <div className="settings-body" data-testid="settings-body">
      {step === "add-channel" && (
        <section className="settings-section" data-testid="add-channel-step">
          <h4>{isFirstRun ? "引导: 选择第一个平台" : "添加 Provider —— 选择平台"}</h4>
          <p className="hint">展开平台, 点击产品直达配置表单(D-025)。</p>
          <ChannelTree onSelect={onPickChannel} />
        </section>
      )}

      {step === "fill-form" && selectedChannel && (
        <section className="settings-section">
          <h4>配置 {selectedChannel.display_name}</h4>
          <DynamicForm
            channel={selectedChannel}
            onBack={() => {
              setStep("add-channel");
              setSelectedChannel(null);
            }}
            onSaved={onSaved}
          />
        </section>
      )}

      {step === "overview" && (
        <>
          <section className="settings-section">
            <h4>实例管理 {instances.length > 0 && <span className="count-badge">{instances.length}</span>}</h4>
            {instances.length === 0 ? (
              <p className="hint" data-testid="no-instances">
                {isFirstRun ? "还没有实例。添加第一个通道即可开始监控。" : "暂无实例。"}
              </p>
            ) : (
              <ul className="instance-list" data-testid="instance-list">
                {instances.map((inst: InstanceConfig) => (
                  <li key={inst.id} className="instance-row" data-testid={`instance-${inst.id}`}>
                    <div className="instance-info">
                      <span className="instance-name">{inst.name}</span>
                      <span className="instance-channel">{inst.channel}</span>
                    </div>
                    {confirmDelete === inst.id ? (
                      <span className="confirm-row">
                        <span className="confirm-text">删除并清钥匙串?</span>
                        <button
                          type="button"
                          className="btn btn-danger"
                          data-testid={`confirm-del-${inst.id}`}
                          onClick={() => {
                            onDelete(inst.id);
                            setConfirmDelete(null);
                          }}
                        >
                          确认
                        </button>
                        <button type="button" className="btn" data-testid={`cancel-del-${inst.id}`} onClick={() => setConfirmDelete(null)}>
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        data-testid={`del-${inst.id}`}
                        onClick={() => setConfirmDelete(inst.id)}
                      >
                        删除
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-primary" data-testid="add-instance" onClick={startAdd}>
              {isFirstRun ? "+ 添加第一个 Provider" : "+ 添加 Provider"}
            </button>
          </section>

          {storagePaths && (
            <section className="settings-section" data-testid="storage-paths">
              <h4>存储路径</h4>
              <dl className="paths">
                <div className="path-row">
                  <dt>配置</dt>
                  <dd data-testid="config-dir">{storagePaths.configDir}</dd>
                </div>
                <div className="path-row">
                  <dt>数据</dt>
                  <dd data-testid="data-dir">{storagePaths.dataDir}</dd>
                </div>
              </dl>
              <p className="hint">配置与数据分家(D-019), 运行时解析的真实路径。</p>
            </section>
          )}

          <section className="settings-section" data-testid="autostart-sec">
            <h4>开机自启</h4>
            <label className="check-row">
              <input
                type="checkbox"
                data-testid="autostart-toggle"
                checked={autoStart}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoStart(next);
                  void setLaunchAtLogin(next);
                }}
              />
              <span>登录时自动启动(默认关,D-024)</span>
            </label>
          </section>

          <section className="settings-section">
            <h4>主题</h4>
            <div className="seg" data-testid="theme-seg">
              {THEME_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`btn${themeMode === o.id ? " active" : ""}`}
                  data-testid={`theme-${o.id}`}
                  onClick={() => onThemeMode(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="hint">默认追随系统(prefers-color-scheme), 可在此覆盖(D-010)。</p>
          </section>

          <section className="settings-section" data-testid="sort-sec">
            <h4>排序</h4>
            <div className="sort-controls">
              <div className="seg" data-testid="sort-key-seg">
                {SORT_KEY_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`btn${sortConfig.key === o.id ? " active" : ""}`}
                    data-testid={`sort-key-${o.id}`}
                    onClick={() => onSortConfig({ ...sortConfig, key: o.id })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="seg" data-testid="sort-dir-seg">
                {SORT_DIR_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`btn${sortConfig.dir === o.id ? " active" : ""}`}
                    data-testid={`sort-dir-${o.id}`}
                    onClick={() => onSortConfig({ ...sortConfig, dir: o.id })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="hint">
              缺省: 名称正排。紧要度 = 按卡内最紧窗口剩余比例(剩余越少越靠前), 方向独立生效(#829 R1)。
            </p>
          </section>
        </>
      )}
      </div>
    </div>
  );
}