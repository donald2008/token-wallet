/**
 * Template 注册点 — DESIGN.md §4, D-004
 *
 * 数据怎么画。core 只定义注册表机制与描述符(UI 无关);
 * 具体模板(bars/ticker 等 React 组件)由 app 包注册, component 为宿主组件引用。
 */
import type { PlanArchetype } from "./schema.js";

export interface TemplateDescriptor {
  /** 模板 id, 如 "bars" / "ticker" */
  id: string;
  display_name: string;
  /** 适配的原型(§6.3: bars→window, ticker→balance ...) */
  archetypes: PlanArchetype[];
  /** 宿主渲染组件引用(React 组件等), core 不关心其类型 */
  component: unknown;
}

export class TemplateRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRegistrationError";
  }
}

export class TemplateRegistry {
  private readonly templates = new Map<string, TemplateDescriptor>();

  register(descriptor: TemplateDescriptor): void {
    if (!descriptor.id) throw new TemplateRegistrationError("模板缺少 id");
    if (this.templates.has(descriptor.id)) {
      throw new TemplateRegistrationError(`模板重复注册: ${descriptor.id}`);
    }
    this.templates.set(descriptor.id, Object.freeze({ ...descriptor }));
  }

  get(id: string): TemplateDescriptor | undefined {
    return this.templates.get(id);
  }

  /** 某原型可用的模板(§6.3 适合原型列) */
  forArchetype(archetype: PlanArchetype): TemplateDescriptor[] {
    return [...this.templates.values()].filter((t) => t.archetypes.includes(archetype));
  }

  list(): TemplateDescriptor[] {
    return [...this.templates.values()];
  }

  get size(): number {
    return this.templates.size;
  }
}
