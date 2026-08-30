/**
 * 写库守卫的「当前实例集合」注册表 —— B-3(t_2ac39613 契约追加)
 *
 * ## 为什么需要它
 *
 * 删除实例的链路是异步的: `store.remove()` 同步改内存 → emit → React `useRealEngine`
 * 异步销毁旧引擎/新建引擎(App.tsx)。旧引擎 `stop()` 之前, **在途采集**的响应仍会走
 * `onResult → storage.saveSnapshot` 写库; purge 与 saveSnapshot 之间没有互斥, 于是
 * 「purge 先跑 → 迟到的采集响应后写」会让幽灵快照重新落库(→ 面板复活)。
 *
 * 契约(B-3)的「先停源」等价实现: 删除瞬间就把该 id 从本注册表剔除, 之后**任何路径**的
 * 该 id 写库入口都静默丢弃 —— 不依赖引擎何时真正 stop, 不依赖 React 何时重建。
 *
 * ## 为什么是独立模块
 *
 * `instances/store.ts` 已 import `runtime/storage.ts`(purgeProvider), 若守卫状态放在
 * store 里则 storage 反向 import 会形成循环依赖。故拆出这个零依赖的叶子模块:
 * store 是唯一写方(实例集合的所有者), storage/engine 只读。
 *
 * ## 未初始化语义
 *
 * `null` = 尚未初始化 → **不过滤**(放行一切)。理由: 只有走过启动流程
 * (`loadPersistedInstances → store.hydrate`)的宿主才有"实例集合"概念;
 * 纯 storage 单测/其它宿主直接写库不应被误丢弃。启动流程一定会 hydrate(含零配置
 * 时的 `hydrate([])`), 所以生产路径恒是已初始化状态。
 */

/** null = 未初始化(不过滤); Set = 当前实例 id 集合 */
let liveIds: Set<string> | null = null;

/** 全量替换(启动预填 store.hydrate 时同步) */
export function setLiveProviders(ids: Iterable<string>): void {
  liveIds = new Set(ids);
}

/** 新增实例(store.add): 未初始化时保持未初始化, 不误开过滤 */
export function addLiveProvider(id: string): void {
  liveIds?.add(id);
}

/** 删除实例(store.remove 的第 1 步「先停源」): 此后该 id 一切写库被丢弃 */
export function removeLiveProvider(id: string): void {
  liveIds?.delete(id);
}

/** 写库入口守卫: true = 放行; false = 静默丢弃(该 id 已不在实例集合内) */
export function isLiveProvider(id: string): boolean {
  return liveIds === null || liveIds.has(id);
}

/** 当前集合快照(调试/断言用); null = 未初始化 */
export function liveProviderIds(): string[] | null {
  return liveIds === null ? null : [...liveIds];
}

/** 测试用: 回到未初始化(不过滤)状态 */
export function resetLiveProviders(): void {
  liveIds = null;
}
