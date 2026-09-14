#!/usr/bin/env node
/** 一次性诊断脚本(2026-09-14): Windows 本机 node 直连 daemon 全流程实测。
 *  用途: 鉴别 electron 进程网络被拦 vs 本机网络层普遍问题。
 *  用法: node win-local-test.mjs   (预期输出一行 OK/FAIL + 耗时)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 读 mcp.env(与 app 同源), 不硬编码 KEY
const envPath = path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "token-wallet", "mcp.env");
let KEY = "", PORT = 9131, HOST = "127.0.0.1";
try {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^(TOKEN_WALLET_MCP_KEY|TOKEN_WALLET_PORT|TOKEN_WALLET_HOST)=(.*)$/);
    if (!m) continue;
    if (m[1] === "TOKEN_WALLET_MCP_KEY") KEY = m[2].trim();
    if (m[1] === "TOKEN_WALLET_PORT") PORT = parseInt(m[2].trim(), 10);
    if (m[1] === "TOKEN_WALLET_HOST") HOST = m[2].trim();
  }
} catch { /* fallback 默认 */ }
if (HOST === "0.0.0.0" || HOST === "::") HOST = "127.0.0.1"; // U6 归一(与 app 一致)
const url = `http://${HOST}:${PORT}/mcp`;
console.log(`目标: ${url}  KEY: ${KEY.slice(0, 6)}...${KEY.slice(-4)} (${KEY.length} hex)`);

const t0 = Date.now();
try {
  const init = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": "Bearer " + KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "win-local-test", version: "1" } } }),
    signal: AbortSignal.timeout(5000),
  });
  const sid = init.headers.get("mcp-session-id");
  console.log(`① initialize: ${init.status} sid=${sid ? "有" : "无"} (${Date.now() - t0}ms)`);
  await init.arrayBuffer();
  const call = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": "Bearer " + KEY, "mcp-session-id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "usage_summary", arguments: { group_by: ["agent"] } } }),
    signal: AbortSignal.timeout(5000),
  });
  console.log(`② tools/call headers: ${call.status} ct=${call.headers.get("content-type")} (${Date.now() - t0}ms)`);
  const reader = call.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", result = null, firstByteMs = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (value && firstByteMs === null) firstByteMs = Date.now() - t0;
    if (value) buf += decoder.decode(value, { stream: true });
    if (buf.includes("data:")) {
      const joined = buf.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n").trim();
      if (joined) { try { result = JSON.parse(joined); reader.cancel().catch(()=>{}); break; } catch {} }
    }
    if (done) break;
  }
  reader.cancel().catch(()=>{});
  if (result) {
    console.log(`③ SSE body: 首字节@${firstByteMs}ms 完成@${Date.now() - t0}ms → 数据到达正常 ✓`);
    console.log(`结论: node.exe 网络不受阻。若 app(electron) 仍超时 = 拦截定向于 electron 进程。`);
  } else {
    console.log(`③ SSE body: 流结束无数据 (buf=${buf.length}B) ✗`);
  }
} catch (e) {
  console.log(`✗ FAIL @${Date.now() - t0}ms: ${e.name}: ${e.message}`);
  console.log(e.cause ? `  cause: ${e.cause}` : "");
}
