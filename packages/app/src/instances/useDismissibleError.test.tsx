// @vitest-environment jsdom
// W3 reviewer BLOCKING 回归测试(review t_5f4fbd09 comment #757):
// 「失败→dismiss→写盘成功(错误清除)→同消息再失败」时错误条必须重弹,
// 否则持久化失败被静默。修复前 dismissedPersistError 在错误清除时不复位,
// 此用例确定性失败。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDismissibleError } from "./useDismissibleError";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MSG = "写盘失败: 磁盘已满";

let container: HTMLDivElement;
let root: Root;

function Harness({ error }: { error: string | null }) {
  const { visible, dismiss } = useDismissibleError(error);
  return (
    <div>
      <span data-testid="visible">{visible ?? ""}</span>
      <button data-testid="dismiss" onClick={dismiss} type="button">
        ×
      </button>
    </div>
  );
}

function render(error: string | null) {
  act(() => {
    root.render(<Harness error={error} />);
  });
}

function visibleText(): string {
  return container.querySelector('[data-testid="visible"]')!.textContent ?? "";
}

function clickDismiss() {
  act(() => {
    container.querySelector<HTMLButtonElement>('[data-testid="dismiss"]')!.click();
  });
}

describe("useDismissibleError", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("错误出现时显示, dismiss 后隐藏且同一错误存续期间不反复弹", () => {
    render(null);
    expect(visibleText()).toBe("");

    render(MSG);
    expect(visibleText()).toBe(MSG);

    clickDismiss();
    expect(visibleText()).toBe("");

    // 同一错误仍存续(未恢复), 重渲染不重弹
    render(MSG);
    expect(visibleText()).toBe("");
  });

  it("dismiss 后出现新消息的错误立即重弹", () => {
    render(MSG);
    clickDismiss();
    expect(visibleText()).toBe("");

    const other = "写盘失败: 权限被拒绝";
    render(other);
    expect(visibleText()).toBe(other);
  });

  it("BLOCKING 回归: dismiss→错误清除(恢复)→同消息再失败 → 错误条重弹", () => {
    render(MSG);
    clickDismiss();
    expect(visibleText()).toBe("");

    // 写盘成功, 错误清除 → dismiss 标记必须复位
    render(null);
    expect(visibleText()).toBe("");

    // 同消息再次失败(磁盘已满类消息高度稳定), 必须重弹而非静默
    render(MSG);
    expect(visibleText()).toBe(MSG);
  });
});
