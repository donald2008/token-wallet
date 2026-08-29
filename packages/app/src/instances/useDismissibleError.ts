import { useEffect, useState } from "react";

/**
 * W3(reviewer BLOCKING 修复): 可关闭的错误提示状态。
 *
 * 修复前 bug: dismiss 标记存的是错误消息字符串, 但错误被写盘成功清除(变 null)时
 * 从不复位 → 「失败→dismiss→成功恢复→同消息再失败」时错误条不重弹,
 * 持久化失败被静默(典型错误如"磁盘已满/权限拒绝"消息高度稳定, 该路径确定性触发)。
 *
 * 现语义: error 变 null(恢复)时 effect 复位 dismiss 标记 → 同消息再次失败会重弹;
 * error 持续存在期间 dismiss 后不反复弹; 出现新消息的错误立即弹出。
 */
export function useDismissibleError(error: string | null): {
  visible: string | null;
  dismiss: () => void;
} {
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (error === null) setDismissed(null);
  }, [error]);

  return {
    visible: error !== null && error !== dismissed ? error : null,
    dismiss: () => setDismissed(error),
  };
}
