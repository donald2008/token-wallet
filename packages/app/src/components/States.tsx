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
