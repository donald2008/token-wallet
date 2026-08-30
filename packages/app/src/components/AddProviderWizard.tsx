import { useState } from "react";
import type { ChannelDescriptor } from "@token-wallet/core/channels";
import { useInstances } from "../instances/store";
import { ChannelTree } from "./ChannelTree";
import { DynamicForm } from "./DynamicForm";

interface Props {
  /** 关闭向导: modal = × 关弹窗, page = ← 返回面板(首开引导 D-021) */
  onBack: () => void;
  /** page = 首开引导页内导航(D-021); modal = 侧栏 ＋ 添加 打开的弹窗 */
  variant?: "page" | "modal";
}

/**
 * 添加 Provider 向导(D-038 从设置页独立出来, 流程本体不变):
 * 选平台(树形通道选择器 D-025) → 填 key(动态表单 D-017/D-026) → 保存。
 *
 * 入口(D-038 操作分区): 侧栏 ＋ 添加(modal) / 空态大按钮引导首加(page, D-021 不变)。
 * 设置弹窗不再承载添加入口与实例列表(设置 = 纯偏好页)。
 *
 * 结构与设置弹窗同构(.settings-view/.settings-head/.settings-body):
 * head 固定不滚, 滚动只在 body(#829 R3 语义沿用)。
 * 保存成功 → 直接关闭向导回面板(新卡即时出现), 不再回落到\"实例列表\"。
 */
export function AddProviderWizard({ onBack, variant = "page" }: Props) {
  const instances = useInstances();
  const [step, setStep] = useState<"add-channel" | "fill-form">("add-channel");
  const [selectedChannel, setSelectedChannel] = useState<ChannelDescriptor | null>(null);
  const isFirstRun = instances.length === 0;

  return (
    <div className="settings-view" data-testid="add-wizard">
      <div className="settings-head">
        <h3>添加 Provider</h3>
        {variant === "modal" ? (
          <button
            type="button"
            className="btn btn-icon"
            data-testid="add-close"
            aria-label="关闭添加向导"
            onClick={onBack}
          >
            ×
          </button>
        ) : (
          <button type="button" className="btn" data-testid="add-back" onClick={onBack}>
            ← 返回
          </button>
        )}
      </div>

      <div className="settings-body" data-testid="settings-body">
        {step === "add-channel" && (
          <section className="settings-section" data-testid="add-channel-step">
            <h4>{isFirstRun ? "引导: 选择第一个平台" : "选择平台"}</h4>
            <p className="hint">展开平台, 点击产品直达配置表单(D-025)。</p>
            <ChannelTree
              onSelect={(d) => {
                setSelectedChannel(d);
                setStep("fill-form");
              }}
            />
          </section>
        )}

        {step === "fill-form" && selectedChannel && (
          <section className="settings-section">
            <h4>配置 {selectedChannel.display_name}</h4>
            <DynamicForm
              channel={selectedChannel}
              onBack={() => {
                setStep("add-channel");
                setSelectedChannel(null);
              }}
              onSaved={onBack}
            />
          </section>
        )}
      </div>
    </div>
  );
}
