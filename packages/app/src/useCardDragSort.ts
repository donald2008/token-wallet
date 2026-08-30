import { useCallback, useEffect, useRef, useState } from "react";
import { reorderByIds } from "./health";

/**
 * 卡片拖动排序 hook(D-039): pointer events 手写, 不引拖拽库。
 *
 * 实现选择说明: **pointer events**(而非 HTML5 drag events)——
 * ① Electron webview 里原生 DnD 的 drag image / dragover 行为不稳(ghost 卡顿/事件丢失);
 * ② Playwright mouse API 天然产生 pointer 事件, e2e 可直接 page.mouse 模拟;
 * ③ jsdom L1 可 dispatch 同形事件, 状态联动可单测。
 *
 * 机制:
 * - pointerdown(仅左键) 在拖动手柄上 → 收集卡片位置 rects + setPointerCapture
 *   (capture 后 pointermove/up 继续发到手柄元素, 拖出窗口不丢事件)
 * - pointermove → 仅更新内存 drag state(overIndex = 落点, dy = 浮起位移), **零写盘**
 * - pointerup   → 调 onDrop(新 order) **恰好一次**(由调用方负责持久化一次)
 * - pointercancel → 取消, 不调 onDrop(零写盘)
 * - 拖动过程中列表 DOM 顺序不变(视觉靠 .card-dragging 的 transform 浮起 + drop-line 指示),
 *   松手才真正 reorder —— 与「拖动过程零写盘, drop 才持久化」契约一致。
 */

export interface DragState {
  /** 被拖卡的 provider_id */
  id: string;
  /** 落点索引(0..ids.length): dragId 落位后的下标 */
  overIndex: number;
  /** 浮起位移(px, 视觉 transform translateY) */
  dy: number;
}

export interface CardRect {
  id: string;
  top: number;
  bottom: number;
}

/** 纯函数: 由各卡 rect 与指针 Y 计算落点索引(可单测, 不依赖 DOM)。
 * 遍历 rects 找第一个中点低于指针的卡 → 落点在其前; 全都不及 → 末尾。 */
export function computeDropIndex(rects: CardRect[], pointerY: number): number {
  for (let i = 0; i < rects.length; i++) {
    const mid = (rects[i].top + rects[i].bottom) / 2;
    if (pointerY < mid) return i;
  }
  return rects.length;
}

/** 由 rects 计算指示线像素 Y(相对 card-list 内容区顶部; card-list 需 position:relative) */
export function computeIndicatorY(rects: CardRect[], overIndex: number, listTop: number): number {
  if (rects.length === 0) return 0;
  if (overIndex === 0) return rects[0].top - listTop - 3;
  if (overIndex >= rects.length) return rects[rects.length - 1].bottom - listTop + 3;
  return (rects[overIndex - 1].bottom + rects[overIndex].top) / 2 - listTop;
}

export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
}

export interface UseCardDragSortOptions {
  /** 当前渲染顺序的 provider_id 数组(拖动期间不变, drop 时用它算新 order) */
  ids: string[];
  /** drop 回调: 收到新 order, 调用方负责 setSortConfig({key:"manual",...}) + 持久化一次 */
  onDrop: (order: string[]) => void;
  /** 卡片列表容器选择器(默认 data-testid=card-list); jsdom 测试可传自定义容器 */
  listSelector?: string;
}

export function useCardDragSort({
  ids,
  onDrop,
  listSelector = '[data-testid="card-list"]',
}: UseCardDragSortOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const idsRef = useRef(ids);
  const onDropRef = useRef(onDrop);
  const startRef = useRef<{
    pointerId: number;
    startY: number;
    rects: CardRect[];
    listTop: number;
  } | null>(null);

  useEffect(() => {
    idsRef.current = ids;
  }, [ids]);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const collectRects = useCallback((handleEl: HTMLElement): { rects: CardRect[]; listTop: number } => {
    const listEl = handleEl.closest<HTMLElement>(listSelector);
    if (!listEl) return { rects: [], listTop: 0 };
    const listRect = listEl.getBoundingClientRect();
    const cards = Array.from(listEl.querySelectorAll<HTMLElement>('[data-testid="provider-card"]'));
    const rects = cards.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute("data-provider") ?? "", top: r.top, bottom: r.bottom };
    });
    return { rects, listTop: listRect.top };
  }, [listSelector]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0) return; // 仅左键
      e.preventDefault(); // 防文本选中/原生行为
      const { rects, listTop } = collectRects(e.currentTarget);
      startRef.current = { pointerId: e.pointerId, startY: e.clientY, rects, listTop };
      setDrag({ id, overIndex: computeDropIndex(rects, e.clientY), dy: 0 });
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom 无 capture, 事件仍冒泡到 React root */
      }
    },
    [collectRects],
  );

  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = startRef.current;
    if (!s) return;
    setDrag((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        overIndex: computeDropIndex(s.rects, e.clientY),
        dy: e.clientY - s.startY,
      };
    });
  }, []);

  const onHandlePointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = startRef.current;
    if (!s) return;
    const overIndex = computeDropIndex(s.rects, e.clientY);
    const order = reorderByIds(idsRef.current, e.currentTarget.dataset.dragId ?? "", overIndex);
    onDropRef.current(order);
    startRef.current = null;
    setDrag(null);
  }, []);

  const onHandlePointerCancel = useCallback(() => {
    startRef.current = null;
    setDrag(null);
  }, []);

  /** 给 ProviderCard 的拖动手柄用的绑定(需再绑到具体 provider_id) */
  const makeHandleProps = useCallback(
    (id: string): DragHandleProps & { "data-drag-id": string } => ({
      "data-drag-id": id,
      onPointerDown: (e) => onHandlePointerDown(e, id),
      onPointerMove: onHandlePointerMove,
      onPointerUp: onHandlePointerUp,
      onPointerCancel: onHandlePointerCancel,
    }),
    [onHandlePointerDown, onHandlePointerMove, onHandlePointerUp, onHandlePointerCancel],
  );

  /** 指示线 Y(相对 card-list 内容区顶部); 无拖动 → null */
  const indicatorY = (() => {
    if (!drag || !startRef.current) return null;
    return computeIndicatorY(startRef.current.rects, drag.overIndex, startRef.current.listTop);
  })();

  return { drag, indicatorY, makeHandleProps };
}
