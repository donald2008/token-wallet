// @vitest-environment jsdom
/**
 * D-043 key 去重 —— DynamicForm 提交拦截 + 内联错误(组件级)。
 *
 * 纯函数 findKeyDuplicate/keyFingerprint 已在 schema.test 覆盖判定逻辑; 本测试证明
 * 表单交互层真的把「同 channel 同 key」挡在提交前: 命中 → 内联 key-error 出现、实例不入 store;
 * 异 channel / 改 key → 正常入库。配合 schema.test 的编辑 ignoreId 用例,
 * 完成契约 4 条验收各有一处的证据链。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPresetChannel } from "@token-wallet/core/channels";

// 浏览器 dev 降级: 无桌面桥 → MemoryKeyring + 内存 store(不落盘)
vi.mock("../ipc", () => ({
  isDesktopHost: () => false,
  httpGetJson: async () => ({ status: 500, body: "{}" }),
  keyringGet: async () => null,
  keyringSet: async () => undefined,
  keyringDelete: async () => undefined,
  instancesLoad: async () => null,
  instancesSave: async () => undefined,
}));

import { DynamicForm } from "./DynamicForm";
import { getSharedStore } from "../instances/store";
import { keyFingerprint } from "../instances/schema";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ds = () => getPresetChannel("deepseek/balance")!;

/** 给 store 预置一个已存实例(带 key_fingerprint), 返回其指纹, 供表单同 key 命中 */
async function seedExisting(key: string, channel = "deepseek/balance"): Promise<void> {
  const fp = await keyFingerprint(key);
  getSharedStore().hydrate([
    {
      id: "existing-1",
      channel,
      name: "DeepSeek-按量 #1",
      key_fingerprint: fp,
      params: { api_key: { source: "store", key: "existing-1:api_key" } },
    },
  ]);
  return;
}

/** 轮询等待条件成立(webcrypto 线程池异步 → 不能用固定 setTimeout 等单帧); 默认 2s 超时 */
async function waitFor(
  cond: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return;
    if (Date.now() > deadline) throw new Error("waitFor 超时: 条件未成立");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function renderForm(channel = ds()): {
  root: Root;
  getByTestId: (id: string) => HTMLElement | null;
  type: (id: string, value: string) => void;
  clickSave: () => Promise<void>;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const getByTestId = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  // store 是否新增过(相对点击前长度)—— renderForm 创建即固定基线, 点击后轮询对比
  const baseLen = getSharedStore().list().length;
  const listChanged = () => getSharedStore().list().length !== baseLen;
  const type = (id: string, value: string) => {
    const el = getByTestId(id) as HTMLInputElement | null;
    if (!el) throw new Error(`no input ${id}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const clickSave = async () => {
    act(() => {
      (getByTestId("save-instance") as HTMLButtonElement | null)?.click();
    });
    // 等保存链路落定: 保存成功 → store.list 长度 +1; 被拦截 → key-error 出现。
    // 不能在 act 里等(会阻塞 flush), 也不固定 sleep —— 轮询等任一信号。
    await waitFor(() => Boolean(getByTestId("key-error")) || listChanged());
  };
  act(() => {
    root.render(<DynamicForm channel={channel} onSaved={() => {}} onBack={() => {}} />);
  });
  return { root, getByTestId, type, clickSave };
}

describe("D-043 DynamicForm key 去重提交拦截", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    getSharedStore().hydrate([]); // 清空共享 store 防污染
  });

  it("同 channel 同 key → 提交被拦截, 内联错误出现, 实例不入 store", async () => {
    const secret = "sk-dupe-123";
    await seedExisting(secret); // 已存 "DeepSeek-按量 #1" 用同 key
    const preCount = getSharedStore().list().length;

    const f = renderForm();
    f.type("param-api_key", secret);
    f.type("inst-name", "DeepSeek-按量 #2");
    await f.clickSave();

    // 内联 key-error 出现(不弹窗)
    const err = f.getByTestId("key-error");
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain("该 key 已存在于实例");
    expect(err!.textContent).toContain("DeepSeek-按量 #1");
    // 同 channel 同 key → 未新增实例(表单被阻断)
    expect(getSharedStore().list().length).toBe(preCount);
  });

  it("异 channel 同 key → 放行, 实例入库", async () => {
    const secret = "sk-cross-channel";
    await seedExisting(secret, "deepseek/balance"); // 已有实例在 deepseek 用该 key
    const preCount = getSharedStore().list().length;

    // 表单在 opencode/go 通道(不同 channel)填同 key → 应放行
    const f = renderForm(getPresetChannel("opencode/go")!);
    f.type("param-api_key", secret);
    f.type("inst-name", "opencode Go #1");
    await f.clickSave();

    expect(f.getByTestId("key-error")).toBeNull();
    expect(getSharedStore().list().length).toBe(preCount + 1); // 新增成功
  });

  it("同 channel 但 key 不同 → 放行", async () => {
    await seedExisting("sk-other"); // 存量 key 是 sk-other
    const preCount = getSharedStore().list().length;

    const f = renderForm();
    f.type("param-api_key", "sk-brand-new");
    f.type("inst-name", "DeepSeek-按量 #2");
    await f.clickSave();

    expect(f.getByTestId("key-error")).toBeNull();
    expect(getSharedStore().list().length).toBe(preCount + 1);
  });
});