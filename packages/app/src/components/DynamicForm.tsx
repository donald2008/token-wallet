/**
 * 动态表单 — DESIGN.md §5.0 (D-017): 由 params_schema 生成。
 * - secret 字段密码框, 不回显已存密钥(§5.0, D-029 内存纪律)
 * - 测试连接(D-017): 立即跑一次采集, 成功显示余额快照, 失败显示具体错误
 * - 实例命名(D-026): name 必填全局唯一, 默认 "<平台>-<产品> #N" 自动编号
 * - 表单校验与实例校验复用同一 zod schema(§5.0): 名称即时唯一校验
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChannelDescriptor } from "@token-wallet/core/channels";
import { defaultInstanceName, findKeyDuplicate, keyFingerprint, type InstanceConfig } from "../instances/schema";
import { existingInstances, existingNames, getSharedKeyring, saveInstance } from "../instances/store";
import { testConnection } from "../connection/testConnection";
import { webSessionAuthStart } from "../ipc";
import { t } from "../i18n";
import type { TestConnectionResult } from "../connection/testConnection";
import type { ProviderSnapshot } from "../types";

interface Props {
  channel: ChannelDescriptor;
  /* 保存已完成(实例已入 store + 钥匙串); 携带新实例供上层做「置顶」等后续(t_d086543b) */
  onSaved?: (inst: InstanceConfig) => void;
  onBack?: () => void;
}

/** 从 health_check.command 取 CLI 可执行名(如 "arkcli auth status …" → "arkcli") */
function cliCommandName(channel: ChannelDescriptor): string {
  const cmd = channel.health_check?.command?.trim();
  if (!cmd) return t("form.cliFallback");
  return cmd.split(/\s+/)[0] ?? t("form.cliFallback");
}

/** 迷你余额/窗口快照展示(测试连接成功)(D-017) */
function SnapshotPreview({ snapshot }: { snapshot: ProviderSnapshot }) {
  return (
    <div className="test-result ok" data-testid="test-ok">
      <span className="test-result-title">{t("form.okTitle")}</span>
      {snapshot.metrics.map((m) => (
        <div key={m.key} className="test-metric">
          <span className="test-metric-value">
            {m.used}
            {m.limit ? ` / ${m.limit}` : ""}
          </span>
          <span className="test-metric-unit">{m.unit} · {m.kind === "balance" ? t("plan.balance") : t("plan.window")}</span>
        </div>
      ))}
    </div>
  );
}

/** 动态表单: 渲染通道 params_schema + 名称 + 测试连接 + 保存 */
export function DynamicForm({ channel, onSaved, onBack }: Props) {
  const [params, setParams] = useState<Record<string, string | number | boolean>>({});
  const [name, setName] = useState<string>(() => defaultInstanceName(channel, existingNames()));
  const [pollInterval, setPollInterval] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  // D-043: key 判重内联错误(null=无冲突可通过); 命中时阻断提交, 不弹窗
  const [keyError, setKeyError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const nameTouched = useRef(false);

  const secretFields = useMemo(
    () => channel.params_schema.filter((f) => f.type === "secret").map((f) => f.key),
    [channel],
  );

  // 通道切换时重置(name 重新自动编号、清空参数与结果)
  useEffect(() => {
    setName(defaultInstanceName(channel, existingNames()));
    setNameError(null);
    setKeyError(null);
    setParams({});
    setTestResult(null);
    setSavedMsg(null);
    nameTouched.current = false;
  }, [channel]);

  const setParam = (key: string, v: string | number | boolean) => {
    setParams((prev) => ({ ...prev, [key]: v }));
    // D-043: 任一 secret 字段变更 → 清除 key 判重错误(用户改了 key 就该重新判定)
    if (secretFields.includes(key) && v)
      setKeyError(null);
  };

  // 名称即时唯一校验(D-026 第 1 道: 表单保存前)
  const currentNameError = (() => {
    if (nameTouched.current && !name.trim()) return t("form.nameEmpty");
    if (name.trim() && !nameError && existingNames().has(name.trim())) return t("form.nameDup", { name: name.trim() });
    return nameError;
  })();

  const onNameChange = (v: string) => {
    nameTouched.current = true;
    setName(v);
    if (v.trim()) setNameError(null);
  };

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testConnection(channel, params);
    setTestResult(res);
    setTesting(false);
  };

  const [pending, setPending] = useState(false);

  // ---- t_e371caca U2: web_session 通道一键授权形态(D-058) ----
  // web_session 型表单 = 「授权登录」按钮 + 会话状态, 无 key 输入框(卡面 ②)。
  // 授权发生在保存前(添加向导场景实例 id 未生成): 表单挂载即生成稳定 formInstId,
  // 授权 cookie 落 keyring `${formInstId}:web_session`; 保存复用同 id(secretFields
  // 含 web_session 时 saveInstance 跳过重复 keyring 写入——值已在, params 引用照建)。
  const isWebSession = channel.auth?.kind === "web_session";
  const [formInstId] = useState(() => `inst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const [authStage, setAuthStage] = useState<"idle" | "authorizing" | "authorized" | "error">("idle");
  const [authMsg, setAuthMsg] = useState("");
  // 通道切换时重置授权态(与 params 重置同 effect, 见下)
  useEffect(() => {
    setAuthStage("idle");
    setAuthMsg("");
  }, [channel]);

  const onWebSessionAuth = () => {
    if (!isWebSession || !channel.auth) return;
    setAuthStage("authorizing");
    setAuthMsg("");
    void webSessionAuthStart(formInstId, channel.auth, `${formInstId}:web_session`).then((res) => {
      if (res.ok && res.saved) {
        // 授权成功: params.web_session 置占位非空值(必填校验/指纹链路照走; cookie 明文只在 keyring)
        setParams((prev) => ({ ...prev, web_session: "authorized" }));
        setAuthStage("authorized");
      } else if (res.cancelled) {
        // 用户手动关窗 = 静默取消(卡面 ①: 不报错), 回 idle 可重试
        setAuthStage("idle");
      } else {
        setAuthMsg(res.message ?? t("form.wsAuthFailed"));
        setAuthStage("error");
      }
    });
  };

  const onSaveClick = async () => {
    // 名称即时校验
    const err = name.trim() ? null : t("form.nameEmpty");
    if (err) {
      setNameError(err);
      return;
    }
    if (existingNames().has(name.trim())) {
      setNameError(t("form.nameDup", { name: name.trim() }));
      return;
    }
    // D-043 key 判重(DynamicForm 提交时, 添加向导提交前): 同 channel 下 key 已存在 → 内联阻断。
    // 计算本次提交的 secret 明文指纹(与 saveInstance 同规: 非空 secret 按字段 key 排序拼接),
    // 比对既有实例同 channel 的 key_fingerprint。命中 → 内联报错, 不落 store、不弹窗。
    const fpSecretPairs = secretFields
      .map((k) => [k, params[k]] as const)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .sort(([a], [b]) => a.localeCompare(b));
    if (fpSecretPairs.length) {
      const fp = await keyFingerprint(fpSecretPairs.map(([, v]) => String(v)).join("\n"));
      const dup = findKeyDuplicate(existingInstances(), channel.channel, fp);
      if (dup) {
        setKeyError(t("form.keyDup", { name: dup.name }));
        return;
      }
    }
    setPending(true);
    try {
      // 保存: secret 值写入钥匙串 + 配置入 store(D-029, §5.0.1)
      const saved = await saveInstance({
        // t_e371caca U2: web_session 授权发生在保存前, keyring 条目已按 formInstId 落盘
        // → 保存复用同 id(引用一致); 非 web_session 通道 id 生成逻辑不变
        id: isWebSession ? formInstId : `inst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        channel: channel.channel,
        name: name.trim(),
        poll_interval: pollInterval.trim() || undefined,
        params,
        secretFields,
        keyring: getSharedKeyring(),
        // web_session: cookie 已在授权流落 keyring, 保存跳过重复写入(值不进 renderer 状态)
        skipSecretWrite: isWebSession,
      });
      setSavedMsg(t("form.saved"));
      // t_d086543b: onSaved 携带新实例(App 用它做 order prepend → 新 provider 置顶)
      onSaved?.(saved);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="dynamic-form"
      data-testid="dynamic-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSaveClick();
      }}
    >
      <h3 className="form-channel-title">{channel.display_name}</h3>
      <p className="hint">{channel.plan_type === "balance" ? t("planType.balance") : t("planType.window")} · {channel.adapter === "command" ? t("form.adapterCommand") : t("form.adapterHttp")}</p>

      {/* t_e371caca U2: web_session 通道一键授权块(卡面 ②: 授权按钮 + 会话状态, 无 key 输入框)。
          域锁/截 cookie/落盘全在主进程(D-058); 表单只呈状态。 */}
      {isWebSession && channel.auth && (
        <div className="command-help" data-testid="web-session-auth-block">
          <span className="command-help-title">{t("form.wsAuthTitle")}</span>
          <span className="command-help-text">{t("form.wsAuthHint", { domain: channel.auth.cookie_domain })}</span>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="web-session-auth-btn"
              disabled={authStage === "authorizing"}
              onClick={onWebSessionAuth}
            >
              {authStage === "authorizing" ? t("form.wsAuthorizing") : t("form.wsAuthStart")}
            </button>
            <span
              className={`hint ${authStage === "authorized" ? "text-ok" : authStage === "error" ? "text-error" : ""}`}
              data-testid="web-session-auth-state"
              data-state={authStage}
            >
              {authStage === "authorized"
                ? t("form.wsAuthOk")
                : authStage === "authorizing"
                  ? t("form.wsAuthWaiting")
                  : authStage === "error"
                    ? authMsg || t("form.wsAuthFailed")
                    : t("form.wsAuthIdle")}
            </span>
          </div>
          {authStage === "error" && (
            <button type="button" className="btn btn-sm" data-testid="web-session-auth-reset" onClick={() => setAuthStage("idle")}>
              {t("card.authRetry")}
            </button>
          )}
        </div>
      )}

      {channel.adapter === "command" && channel.health_check?.setup_hint && (
        <div className="command-help" data-testid="command-help">
          <span className="command-help-title">{t("form.twoStep")}</span>
          <span className="command-help-text">
            {t("form.twoStep1")}<code>{cliCommandName(channel)}</code>{t("form.twoStep2")}
            <br />
            {t("form.twoStepLogin", { hint: channel.health_check.setup_hint ?? "" })}
          </span>
        </div>
      )}

      <label className="field">
        <span className="field-label">{t("form.nameLabel")}</span>
        <input
          type="text"
          className="input"
          data-testid="inst-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("form.namePlaceholder")}
        />
        {currentNameError && <span className="field-error" data-testid="name-error">{currentNameError}</span>}
      </label>

      {channel.params_schema
        // t_e371caca U2: web_session 通道无 key 输入框(卡面 ②)——凭据由一键授权流落 keyring
        .filter((f) => !(isWebSession && f.type === "secret"))
        .map((f) => {
        const value = params[f.key];
        // 密码框 + placeholder 占位(不回显已存密钥 §5.0)
        const placeholder = f.required && secretFields.includes(f.key) ? "••••••••" : undefined;
        return (
          <label key={f.key} className="field">
            <span className="field-label">
              {f.label}
              {f.required && <span className="req"> *</span>}
            </span>
            {f.type === "boolean" ? (
              <label className="check-row">
                <input
                  type="checkbox"
                  data-testid={`param-${f.key}`}
                  checked={Boolean(value ?? f.default)}
                  onChange={(e) => setParam(f.key, e.target.checked)}
                />
                <span>{f.help ?? ""}</span>
              </label>
            ) : f.type === "number" ? (
              <input
                type="number"
                className="input"
                data-testid={`param-${f.key}`}
                value={value === undefined ? String(f.default ?? "") : String(value)}
                onChange={(e) => setParam(f.key, Number(e.target.value))}
              />
            ) : (
              <input
                type={f.type === "secret" ? "password" : "text"}
                className="input"
                data-testid={`param-${f.key}`}
                value={value === undefined ? String(f.default ?? "") : String(value)}
                placeholder={placeholder}
                onChange={(e) => setParam(f.key, e.target.value)}
              />
            )}
            {f.help && f.type !== "boolean" && <span className="field-help">{f.help}</span>}
          </label>
        );
      })}

      {/* D-043: key 判重内联错误 —— 命中同 channel 同 key, 阻断提交, 不弹窗 */}
      {keyError && (
        <div className="field-error" data-testid="key-error" role="alert">
          {keyError}
        </div>
      )}

      <label className="field">
        <span className="field-label">{t("form.pollLabel")}</span>
        <input
          type="text"
          className="input"
          data-testid="poll-interval"
          value={pollInterval}
          onChange={(e) => setPollInterval(e.target.value)}
          placeholder={t("form.pollPlaceholder")}
        />
      </label>

      <div className="form-actions">
        <button type="button" className="btn" data-testid="test-conn" disabled={testing} onClick={onTest}>
          {testing ? t("form.testing") : t("form.test")}
        </button>
        <button type="submit" className="btn btn-primary" data-testid="save-instance" disabled={pending}>
          {pending ? t("form.saving") : t("form.save")}
        </button>
        {onBack && (
          <button type="button" className="btn" data-testid="form-back" onClick={onBack}>
            {t("form.back")}
          </button>
        )}
      </div>

      {testResult && !testResult.ok && (
        <div className="test-result err" data-testid="test-err">{testResult.error}</div>
      )}
      {testResult && testResult.ok && <SnapshotPreview snapshot={testResult.snapshot} />}
      {savedMsg && <div className="saved" data-testid="saved-msg">✓ {savedMsg}</div>}
    </form>
  );
}