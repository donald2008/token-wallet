import { t } from "../i18n";

/** 首开隐私声明页(D-021 §10): 零遥测/零上报/数据不出本机, 须点同意。P0-2 为占位实现。 */
export function ConsentPage({ onAgree }: { onAgree: () => void }) {
  return (
    <div className="placeholder" data-testid="consent-page">
      <h2>{t("consent.title")}</h2>
      <p>
        {t("consent.l1a")}
        <strong>{t("consent.l1b")}</strong>
        {t("consent.l1c")}
        <strong>{t("consent.l1d")}</strong>。
      </p>
      <p>{t("consent.p2")}</p>
      <button type="button" className="btn btn-primary" data-testid="consent-agree" onClick={onAgree}>
        {t("consent.agree")}
      </button>
    </div>
  );
}

/** 空态: 初始零 provider 配置(§10) */
export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="placeholder" data-testid="empty-state">
      <h2>{t("empty.title")}</h2>
      <p>{t("empty.desc")}</p>
      <button type="button" className="btn btn-primary" data-testid="add-provider" onClick={onAdd}>
        {t("common.add")}
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
      <h2>{t("collecting.title")}</h2>
      <p>{t("collecting.desc")}</p>
    </div>
  );
}

/** 过滤无匹配(P1 t_6484ecc6): chips 过滤后 providers 非空但命中为空 → 居中「无匹配实例」。 */
export function NoMatchState() {
  return (
    <div className="placeholder" data-testid="no-match">
      <h2>{t("noMatch.title")}</h2>
      <p>{t("noMatch.desc")}</p>
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
      <h2>{t("cfgErr.title")}</h2>
      <p>
        {t("cfgErr.desc")}
      </p>
      {instancesPath && (
        <p data-testid="config-error-path">
          {t("cfgErr.pathLabel")}<code>{instancesPath}</code>
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
      <span className="persist-error-text">{t("persistError.text", { error })}</span>
      <button
        type="button"
        className="persist-error-close"
        aria-label={t("common.close")}
        data-testid="persist-error-dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
