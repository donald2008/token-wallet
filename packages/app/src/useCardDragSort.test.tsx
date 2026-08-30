// @vitest-environment jsdom
/**
 * L1(D-039): 卡片拖动排序 hook —— 拖动过程只更新内存 state(零写盘),
 * 松手(drop)才调一次 onDrop(由 App 侧切 manual + 持久化)。
 *
 * 覆盖验收:
 * - pointerdown 起拖 → 状态进入 dragging, 面板顺序 DOM 不变
 * - pointermove 只更新 overIndex/dy(不触发 onDrop = 零写盘)
 * - pointerup(drop) → onDrop 恰一次, order = reorderByIds 结果
 * - pointercancel → 取消, onDrop 零次
 * - computeDropIndex / computeIndicatorY / reorderByIds 纯函数正确性
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeDropIndex, computeIndicatorY, useCardDragSort, type CardRect } from "./useCardDragSort";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 触发 pointer 事件(jsdom 无 PointerEvent 构造器 → 用 MouseEvent + 补 pointerId) */
function firePointer(
  el: Element | null,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  opts: { clientY: number; button?: number; pointerId?: number },
): void {
  expect(el, `pointer 事件 ${type} 的目标元素必须存在`).toBeTruthy();
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: opts.clientY,
    button: opts.button ?? 0,
  });
  Object.defineProperty(ev, "pointerId", { value: opts.pointerId ?? 1 });
  act(() => {
    el!.dispatchEvent(ev);
  });
}

interface Item {
  id: string;
  name: string;
}

/** 面板同构 harness: ProviderCard 列表 + useCardDragSort, 模拟 App 的卡片区 */
function Harness({
  items,
  onDrop,
  onOrderChange,
}: {
  items: Item[];
  onDrop: (order: string[]) => void;
  onOrderChange: (order: string[]) => void;
}) {
  const ids = items.map((i) => i.id);
  const { drag, indicatorY, makeHandleProps } = useCardDragSort({ ids, onDrop });
  // 通知测试侧当前渲染顺序(拖动期间应保持不变)
  onOrderChange(ids);
  return (
    <div className="card-list" data-testid="card-list">
      {drag && indicatorY !== null && <div className="drop-line" data-testid="drop-line" style={{ top: indicatorY }} />}
      {items.map((i) => (
        <section
          key={i.id}
          className={`card${drag?.id === i.id ? " card-dragging" : ""}`}
          data-testid="provider-card"
          data-provider={i.id}
        >
          <div className="card-head">
            <span
              className="brand-block drag-handle"
              data-testid={`drag-handle-${i.id}`}
              {...makeHandleProps(i.id)}
            />
            <span className="card-name">{i.name}</span>
          </div>
        </section>
      ))}
    </div>
  );
}

/** mock getBoundingClientRect: 给 .card 赋 40px 高、间距 8px 的确定性布局 */
function mockCardRects(): void {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="provider-card"]'));
  cards.forEach((el, i) => {
    const top = 10 + i * 48;
    el.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  });
  const list = container.querySelector<HTMLElement>('[data-testid="card-list"]')!;
  list.getBoundingClientRect = () =>
    ({ top: 0, left: 0, width: 300, height: 400, right: 300, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

describe("computeDropIndex / computeIndicatorY(纯函数)", () => {
  const rects: CardRect[] = [
    { id: "a", top: 10, bottom: 50 }, // 中点 30
    { id: "b", top: 58, bottom: 98 }, // 中点 78
    { id: "c", top: 106, bottom: 146 }, // 中点 126
  ];

  it("指针在卡中点之上 → 落点在其前; 全都不及 → 末尾", () => {
    expect(computeDropIndex(rects, 20)).toBe(0);
    expect(computeDropIndex(rects, 30)).toBe(1); // 恰好中点 → 排到该卡后
    expect(computeDropIndex(rects, 100)).toBe(2);
    expect(computeDropIndex(rects, 999)).toBe(3);
  });

  it("indicatorY 对应插入边界像素", () => {
    expect(computeIndicatorY(rects, 0, 0)).toBe(7); // 第一张卡顶 -3
    expect(computeIndicatorY(rects, 3, 0)).toBe(149); // 最后一张卡底 +3
    expect(computeIndicatorY(rects, 1, 0)).toBe((50 + 58) / 2); // a/b 之间
  });
});

describe("useCardDragSort: 拖动 state 联动 + drop 才触发(零写盘)", () => {
  const items: Item[] = [
    { id: "a", name: "百炼" },
    { id: "b", name: "方舟" },
    { id: "c", name: "DeepSeek" },
  ];

  it("pointerdown → 起拖(卡浮起 + 指示线), DOM 顺序不变", () => {
    const drops: string[][] = [];
    const orders: string[][] = [];
    act(() => {
      root.render(<Harness items={items} onDrop={(o) => drops.push(o)} onOrderChange={(o) => orders.push(o)} />);
    });
    mockCardRects();
    const handleA = container.querySelector('[data-testid="drag-handle-a"]');
    firePointer(handleA, "pointerdown", { clientY: 30 });
    // 起拖: A 卡带 card-dragging, 指示线出现
    expect(container.querySelector('[data-testid="provider-card"][data-provider="a"]')!.className).toContain(
      "card-dragging",
    );
    expect(container.querySelector('[data-testid="drop-line"]')).toBeTruthy();
    expect(drops).toEqual([]);
    // 渲染顺序仍是 a,b,c(拖动不重排 DOM)
    expect(orders[orders.length - 1]).toEqual(["a", "b", "c"]);
  });

  it("pointermove 只更新落点(不触发 onDrop = 拖动中零写盘); pointerup 触发恰一次", () => {
    const drops: string[][] = [];
    const orders: string[][] = [];
    act(() => {
      root.render(<Harness items={items} onDrop={(o) => drops.push(o)} onOrderChange={(o) => orders.push(o)} />);
    });
    mockCardRects();
    const handleA = container.querySelector('[data-testid="drag-handle-a"]');
    firePointer(handleA, "pointerdown", { clientY: 30 });
    // 多次 move: 拖到 C 下方(中点 126 之后 → overIndex 3)
    firePointer(handleA, "pointermove", { clientY: 200 });
    firePointer(handleA, "pointermove", { clientY: 250 });
    expect(drops).toEqual([]); // 拖动中零写盘
    // drop: 触发一次, order = [b, c, a]
    firePointer(handleA, "pointerup", { clientY: 250 });
    expect(drops).toEqual([["b", "c", "a"]]);
    // 松手后拖态清空
    expect(container.querySelector('[data-testid="provider-card"][data-provider="a"]')!.className).not.toContain(
      "card-dragging",
    );
    expect(container.querySelector('[data-testid="drop-line"]')).toBeNull();
  });

  it("pointercancel → 取消, onDrop 零次(取消不写盘)", () => {
    const drops: string[][] = [];
    act(() => {
      root.render(<Harness items={items} onDrop={(o) => drops.push(o)} onOrderChange={() => {}} />);
    });
    mockCardRects();
    const handleA = container.querySelector('[data-testid="drag-handle-a"]');
    firePointer(handleA, "pointerdown", { clientY: 30 });
    firePointer(handleA, "pointermove", { clientY: 250 });
    firePointer(handleA, "pointercancel", { clientY: 250 });
    expect(drops).toEqual([]);
    expect(container.querySelector('[data-testid="drop-line"]')).toBeNull();
  });

  it("非左键(button=1)不触发拖动", () => {
    const drops: string[][] = [];
    act(() => {
      root.render(<Harness items={items} onDrop={(o) => drops.push(o)} onOrderChange={() => {}} />);
    });
    mockCardRects();
    firePointer(container.querySelector('[data-testid="drag-handle-a"]'), "pointerdown", {
      clientY: 30,
      button: 1,
    });
    expect(container.querySelector('[data-testid="provider-card"][data-provider="a"]')!.className).not.toContain(
      "card-dragging",
    );
  });

  it("从名称模式直接拖 → onDrop 收到完整新 order(App 侧切 manual 由回调完成)", () => {
    const drops: string[][] = [];
    act(() => {
      root.render(<Harness items={items} onDrop={(o) => drops.push(o)} onOrderChange={() => {}} />);
    });
    mockCardRects();
    const handleC = container.querySelector('[data-testid="drag-handle-c"]');
    firePointer(handleC, "pointerdown", { clientY: 126 });
    // 拖到最前(a 中点 30 之上)
    firePointer(handleC, "pointermove", { clientY: 10 });
    firePointer(handleC, "pointerup", { clientY: 10 });
    expect(drops).toEqual([["c", "a", "b"]]);
  });

  it("onDrop 回调引用变化不破坏拖动(idsRef/onDropRef 保持最新)", () => {
    const drops: string[][] = [];
    const onDrop = vi.fn((o: string[]) => drops.push(o));
    act(() => {
      root.render(<Harness items={items} onDrop={onDrop} onOrderChange={() => {}} />);
    });
    mockCardRects();
    const handleA = container.querySelector('[data-testid="drag-handle-a"]');
    firePointer(handleA, "pointerdown", { clientY: 30 });
    firePointer(handleA, "pointerup", { clientY: 200 });
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(drops).toEqual([["b", "c", "a"]]);
  });
});
