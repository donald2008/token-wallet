/**
 * 动态表单 — DESIGN.md §5.0 (D-017): 由 params_schema 生成。
 * - secret 字段密码框, 不回显已存密钥(§5.0, D-029 内存纪律)
 * - 测试连接(D-017): 立即跑一次采集, 成功显示余额快照, 失败显示具体错误
 * - 实例命名(D-026): name 必填全局唯一, 默认 "<平台>-<产品> #N" 自动编号
 * - 表单校验与实例校验复用同一 zod schema(§5.0): 名称即时唯一校验
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChannelDescriptor } from "@token-wallet/core/channels";
import { defaultInstanceName, findKeyDuplicate, keyFingerprint } from "../instances/schema";
import { existingInstances, existingNames, getSharedKeyring, saveInstance } from "../instances/store";
import { testConnection } from "../connection/testConnection";
import type { TestConnectionResult } from "../connection/testConnection";
import type { ProviderSnapshot } from "../types";

interface Props {
  channel: ChannelDescriptor;
  /* 保存已完成(实例已入 store + 钥匙串) */
  onSaved?: () => void;
  onBack?: () => void;
}

/** 从 health_check.command 取 CLI 可执行名(如 "arkcli auth status …" → "arkcli") */
function cliCommandName(channel: ChannelDescriptor): string {
  const cmd = channel.health_check?.command?.trim();
  if (!cmd) return "官方 CLI";
  return cmd.split(/\s+/)[0] ?? "官方 CLI";
}

/** 迷你余额/窗口快照展示(测试连接成功)(D-017) */
function SnapshotPreview({ snapshot }: { snapshot: ProviderSnapshot }) {
  return (
    <div className="test-result ok" data-testid="test-ok">
      <span className="test-result-title">✓ 连接成功</span>
      {snapshot.metrics.map((m) => (
        <div key={m.key} className="test-metric">
          <span className="test-metric-value">
            {m.used}
            {m.limit ? ` / ${m.limit}` : ""}
          </span>
          <span className="test-metric-unit">{m.unit} · {m.kind === "balance" ? "余额" : "窗口"}</span>
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
    if (nameTouched.current && !name.trim()) return "实例名不能为空";
    if (name.trim() && !nameError && existingNames().has(name.trim())) return `实例名已存在: ${name.trim()}`;
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

  const onSaveClick = async () => {
    // 名称即时校验
    const err = name.trim() ? null : "实例名不能为空";
    if (err) {
      setNameError(err);
      return;
    }
    if (existingNames().has(name.trim())) {
      setNameError(`实例名已存在: ${name.trim()}`);
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
        setKeyError(`该 key 已存在于实例「${dup.name}」`);
        return;
      }
    }
    setPending(true);
    try {
      // 保存: secret 值写入钥匙串 + 配置入 store(D-029, §5.0.1)
      await saveInstance({
        id: `inst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        channel: channel.channel,
        name: name.trim(),
        poll_interval: pollInterval.trim() || undefined,
        params,
        secretFields,
        keyring: getSharedKeyring(),
      });
      setSavedMsg("已保存到实例列表");
      onSaved?.();
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
      <p className="hint">{channel.plan_type === "balance" ? "余额制" : "窗口制"} · {channel.adapter === "command" ? "command(官方 CLI)" : "http"}</p>

      {channel.adapter === "command" && channel.health_check?.setup_hint && (
        <div className="command-help" data-testid="command-help">
          <span className="command-help-title">两段式授权</span>
          <span className="command-help-text">
            ① 先安装官方 CLI(<code>{cliCommandName(channel)}</code>, 见通道说明)
            <br />
            ② 再完成一次登录:{channel.health_check.setup_hint}
          </span>
        </div>
      )}

      <label className="field">
        <span className="field-label">实例名称</span>
        <input
          type="text"
          className="input"
          data-testid="inst-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="DeepSeek-按量 #1"
        />
        {currentNameError && <span className="field-error" data-testid="name-error">{currentNameError}</span>}
      </label>

      {channel.params_schema.map((f) => {
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
        <span className="field-label">轮询间隔</span>
        <input
          type="text"
          className="input"
          data-testid="poll-interval"
          value={pollInterval}
          onChange={(e) => setPollInterval(e.target.value)}
          placeholder="5m(可选, 覆盖全局默认)"
        />
      </label>

      <div className="form-actions">
        <button type="button" className="btn" data-testid="test-conn" disabled={testing} onClick={onTest}>
          {testing ? "测试中…" : "测试连接"}
        </button>
        <button type="submit" className="btn btn-primary" data-testid="save-instance" disabled={pending}>
          {pending ? "保存中…" : "保存实例"}
        </button>
        {onBack && (
          <button type="button" className="btn" data-testid="form-back" onClick={onBack}>
            ← 返回选择
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