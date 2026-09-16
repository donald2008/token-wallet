/**
 * 地址归一工具(t_da2fd1f1 U6):
 * TOKEN_WALLET_HOST 是 bind 地址; 0.0.0.0 / :: / [::] 是通配 bind,
 * **不能**用作 connect 目标(Windows 上连 0.0.0.0 会挂起到超时)。
 * 连接侧一律归一 127.0.0.1(通配 bind 必含 loopback); 展示侧解析局域网 IPv4。
 */

/** 通配 bind 地址判定(bind-only, 非 connect 目标) */
export function isWildcardHost(host: string): boolean {
  const h = (host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "0.0.0.0" || h === "::" || h === "0:0:0:0:0:0:0:0" || h === "any";
}

/**
 * 连接目标归一: 通配 bind → 127.0.0.1(通配 bind 必监听 loopback);
 * 其余(127.0.0.1 / 局域网 IP / 主机名)原样返回。
 */
export function connectHost(host: string): string {
  return isWildcardHost(host) ? "127.0.0.1" : host;
}

/** 局域网展示地址解析: 首个非 internal IPv4(多网卡取序首个), 无 → null */
export function lanIPv4(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("node:os") as typeof import("node:os");
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === "IPv4" && !net.internal) return net.address;
      }
    }
  } catch {
    /* os 不可用(非 node 环境) → 走 fallback */
  }
  return null;
}

/** 通配 host 的用户可见 endpoint host: 局域网 IPv4 优先, 兜底 127.0.0.1 */
export function displayHost(host: string): string {
  return isWildcardHost(host) ? (lanIPv4() ?? "127.0.0.1") : host;
}
