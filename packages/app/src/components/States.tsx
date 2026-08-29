/** 首开隐私声明页(D-021 §10): 零遥测/零上报/数据不出本机, 须点同意。P0-2 为占位实现。 */
export function ConsentPage({ onAgree }: { onAgree: () => void }) {
  return (
    <div className="placeholder" data-testid="consent-page">
      <h2>欢迎使用 token-wallet</h2>
      <p>
        本应用<strong>零遥测、零上报</strong>, 你的套餐与凭据数据
        <strong>只保存在本机</strong>。
      </p>
      <p>继续使用即表示你已知晓以上隐私声明。</p>
      <button type="button" className="btn btn-primary" data-testid="consent-agree" onClick={onAgree}>
        同意并继续
      </button>
    </div>
  );
}

/** 空态: 初始零 provider 配置(§10) */
export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="placeholder" data-testid="empty-state">
      <h2>暂无 Provider</h2>
      <p>添加第一个 AI 套餐 / 余额通道, 额度健康状况将显示在这里。</p>
      <button type="button" className="btn btn-primary" data-testid="add-provider" onClick={onAdd}>
        添加 Provider
      </button>
    </div>
  );
}

/** 加载态骨架屏(cache-first 下应一闪而过, §3.1) */
export function LoadingState() {
  return (
    <div className="card-list" data-testid="loading-state" aria-busy="true">
      <div className="skeleton-card" />
      <div className="skeleton-card" />
      <div className="skeleton-card" />
    </div>
  );
}

/**
 * 采集进行中(P0-8): 已配置实例但首个快照未到(引擎启动中/采集中)时显示。
 * 与 EmptyState 严格区分 —— 用户已添加过 Provider, 再显示"添加 Provider"是误导。
 */
export function CollectingState() {
  return (
    <div className="placeholder" data-testid="collecting-state" aria-busy="true">
      <h2>数据采集中</h2>
      <p>已配置的 Provider 正在采集额度数据, 首个快照到达后即显示。</p>
    </div>
  );
}

/** 配置损坏 fail-fast(§5.0.1/P0-7): instances.yaml 解析/校验失败时停在此页, 不静默丢配置 */
export function ConfigErrorState({
  error,
  instancesPath,
}: {
  error: string;
  /** instances.yaml 完整路径(运行时 get_storage_paths 解析, 零硬编码) */
  instancesPath?: string;
}) {
  return (
    <div className="placeholder" data-testid="config-error">
      <h2>配置加载失败</h2>
      <p>
        实例配置(instances.yaml)损坏或未通过校验。为避免覆盖你的配置,
        应用已停止加载, 请修复配置文件后重启。
      </p>
      {instancesPath && (
        <p data-testid="config-error-path">
          配置文件位置: <code>{instancesPath}</code>
        </p>
      )}
      <p data-testid="config-error-detail">{error}</p>
    </div>
  );
}

/**
 * 持久化写盘失败错误条(W3): 配置未能保存到磁盘时置顶显示, 可关闭。
 * 内存态仍可用(不回滚是有意设计), 但重启后可能丢失 —— 必须让用户看见, 不用 alert。
 */
export function PersistErrorBar({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div className="persist-error-bar" role="alert" data-testid="persist-error-bar">
      <span className="persist-error-text">配置未能保存到磁盘，重启后可能丢失：{error}</span>
      <button
        type="button"
        className="persist-error-close"
        aria-label="关闭"
        data-testid="persist-error-dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
