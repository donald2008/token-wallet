/**
 * Notifier 注册点 — DESIGN.md §4, D-009
 *
 * 异常往哪报。P3 前空实现, 接口先行(配置 notifications.enabled=false 占位)。
 * 实现方示例: Windows 原生通知(桌面壳 notification) / MM 作战室通道(§9)。
 */
import type { AlertLevel } from "./schema.js";

export interface NotifyEvent {
  level: AlertLevel;
  title: string;
  message: string;
  provider_id?: string;
  /** 事件时间(unix 秒) */
  at: number;
}

export interface Notifier {
  readonly id: string;
  notify(event: NotifyEvent): Promise<void>;
}

/** P3 前空实现(D-009): 吞掉事件, 仅计数便于测试/自检 */
export class NoopNotifier implements Notifier {
  readonly id = "noop";
  /** 已接收事件数(自检用, 不存内容防泄漏) */
  received = 0;

  async notify(_event: NotifyEvent): Promise<void> {
    this.received += 1;
  }
}

export class NotifierRegistry {
  private readonly notifiers = new Map<string, Notifier>();

  register(notifier: Notifier): void {
    if (this.notifiers.has(notifier.id)) {
      throw new Error(`Notifier 重复注册: ${notifier.id}`);
    }
    this.notifiers.set(notifier.id, notifier);
  }

  get(id: string): Notifier | undefined {
    return this.notifiers.get(id);
  }

  /** 广播事件给全部已注册 notifier, 单个失败不阻塞其他 */
  async dispatch(event: NotifyEvent): Promise<void> {
    await Promise.allSettled([...this.notifiers.values()].map((n) => n.notify(event)));
  }

  get size(): number {
    return this.notifiers.size;
  }
}
