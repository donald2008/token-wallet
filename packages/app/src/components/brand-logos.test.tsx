// @vitest-environment jsdom
/**
 * P1(t_696ec820): BrandLogo 注册表回退逻辑。
 * - 收录平台 → 渲染单色 SVG(内含 path, fill=currentColor, viewBox 24, 尺寸=size)
 * - 别名(旧 mock provider_id) → 解析到注册表 key
 * - 未收录平台 → 回退品牌色块(span, background 来自 BRAND_COLORS 或 fallback)
 * - 空/未知 → 不崩(generic 兜底或色块)
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrandLogo, hasBrandGlyph, resolveBrandKey, BRAND_GLYPHS } from "./brand-logos";

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

function renderLogo(platform: string, size = 16): HTMLElement {
  act(() => {
    root.render(<BrandLogo platform={platform} size={size} />);
  });
  return container.firstElementChild as HTMLElement;
}

/** 收录平台: 根元素即 <svg>(BrandLogo glyph 直接渲染 svg 为根)。 */
function findSvg(el: HTMLElement): SVGSVGElement | null {
  return el.tagName.toLowerCase() === "svg" ? (el as unknown as SVGSVGElement) : el.querySelector("svg");
}

describe("BrandLogo 注册表: 收录 → SVG, 未收录 → 色块回退(P1)", () => {
  it("收录平台渲染单色 SVG: viewBox 24 + currentColor + 尺寸", () => {
    const el = renderLogo("deepseek", 16);
    const svg = findSvg(el!);
    expect(svg, "deepseek 必须渲染 SVG").toBeTruthy();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg!.getAttribute("width")).toBe("16");
    const path = svg!.querySelector("path")!;
    expect(path.getAttribute("fill")).toBe("currentColor");
    expect(path.getAttribute("d")!.length).toBeGreaterThan(10);
  });

  it("首批 9 个 logo 全部收录(含 token-wallet 自身 + generic 兜底)", () => {
    const required = [
      "deepseek",
      "kimi",
      "aliyun-bailian",
      "opencode",
      "volcengine-ark",
      "minimax",
      "zai",
      "token-wallet",
      "generic",
    ];
    for (const k of required) {
      expect(BRAND_GLYPHS[k], `${k} 必须收录`).toBeTruthy();
      expect(findSvg(renderLogo(k, 12)), `${k} 渲染 SVG`).toBeTruthy();
    }
  });

  it("别名解析: kimi-code/opencode-go/aliyun/ark → 注册表 key", () => {
    expect(resolveBrandKey("kimi-code")).toBe("kimi");
    expect(resolveBrandKey("opencode-go")).toBe("opencode");
    expect(resolveBrandKey("aliyun")).toBe("aliyun-bailian");
    expect(resolveBrandKey("ark")).toBe("volcengine-ark");
    expect(hasBrandGlyph("kimi-code")).toBe(true);
    expect(hasBrandGlyph("opencode-go")).toBe(true);
  });

  it("未收录平台 → 回退品牌色块(span + background), 不渲染 SVG", () => {
    const el = renderLogo("some-unknown-platform", 16);
    expect(findSvg(el)).toBeNull();
    expect(el.tagName).toBe("SPAN");
    // 色块: 具尺寸 + background 非空(回退 BRAND_COLORS 或 var(--unknown))
    expect(el.style.width).toBe("16px");
    expect(el.style.height).toBe("16px");
    expect(el.style.background).not.toBe("");
  });

  it("空串/未知 → generic 兜底不崩", () => {
    expect(resolveBrandKey("")).toBe("generic");
    const el = renderLogo("");
    // generic 收录 → 渲染 SVG
    expect(resolveBrandKey("") in BRAND_GLYPHS).toBe(true);
    expect(findSvg(el)).toBeTruthy();
    expect(el.getAttribute("aria-label")).toBe("");
  });
});