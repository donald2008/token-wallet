// @vitest-environment node
// t_da2fd1f1 U6 回归: TOKEN_WALLET_HOST 是 bind 地址 — 通配(0.0.0.0/::)不能作 connect 目标。
// connectHost 归一 loopback; displayHost/lanIPv4 解析局域网 IPv4 供 UI 展示。
import { describe, expect, it } from "vitest";
import * as os from "node:os";
import { connectHost, displayHost, isWildcardHost, lanIPv4 } from "./mcp-address";

describe("isWildcardHost", () => {
  it("0.0.0.0 / :: / [::] / 变体 → true", () => {
    expect(isWildcardHost("0.0.0.0")).toBe(true);
    expect(isWildcardHost("::")).toBe(true);
    expect(isWildcardHost("[::]")).toBe(true);
    expect(isWildcardHost("0:0:0:0:0:0:0:0")).toBe(true);
    expect(isWildcardHost(" 0.0.0.0 ")).toBe(true);
  });
  it("具体地址 → false", () => {
    expect(isWildcardHost("127.0.0.1")).toBe(false);
    expect(isWildcardHost("10.200.1.110")).toBe(false);
    expect(isWildcardHost("localhost")).toBe(false);
    expect(isWildcardHost("::1")).toBe(false);
  });
});

describe("connectHost (probe/start/stop/restart/read 全走这里)", () => {
  it("通配 bind → 127.0.0.1 (Windows 连 0.0.0.0 会挂起超时)", () => {
    expect(connectHost("0.0.0.0")).toBe("127.0.0.1");
    expect(connectHost("::")).toBe("127.0.0.1");
  });
  it("具体 bind → 原样", () => {
    expect(connectHost("127.0.0.1")).toBe("127.0.0.1");
    expect(connectHost("10.200.1.110")).toBe("10.200.1.110");
  });
});

describe("lanIPv4 / displayHost", () => {
  it("lanIPv4: 本机存在非 internal IPv4 → 返回之; 否则 null", () => {
    const nets = os.networkInterfaces();
    const expected = Object.values(nets)
      .flat()
      .find((n) => n && n.family === "IPv4" && !n.internal)?.address;
    expect(lanIPv4()).toBe(expected ?? null);
  });
  it("displayHost: 通配 → 局域网 IPv4(无则 127.0.0.1); 具体地址原样", () => {
    const lan = lanIPv4();
    if (lan) {
      expect(displayHost("0.0.0.0")).toBe(lan);
    } else {
      expect(displayHost("0.0.0.0")).toBe("127.0.0.1");
    }
    expect(displayHost("127.0.0.1")).toBe("127.0.0.1");
    expect(displayHost("192.168.1.5")).toBe("192.168.1.5");
  });
});
