"""schema 一致性断言 (OB-01 REQ-02 / SC-04, 20-strategy S2)。

单一事实源 = docs/mcp-protocol.md: guide_doc.py 的三个逐字常量
(SCHEMA_JSON / ENVELOPE_JSON / EXAMPLE_PAYLOAD) 与权威源对应节**逐字比对**,
任一字符漂移即红 (篡改防护)。协议变更流程: 先改 mcp-protocol.md,
再程序化重新提取更新常量 — 禁手编。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
PROTOCOL_MD = REPO_ROOT / "docs" / "mcp-protocol.md"

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from mcp_server import guide_doc  # noqa: E402


# ------------------------------------------------------------ 权威源提取 --

def _protocol_block(anchor: str) -> str:
    """从 docs/mcp-protocol.md 提取 anchor 之后第一个 ```json 围栏块原文。"""
    md = PROTOCOL_MD.read_text(encoding="utf-8")
    i = md.index(anchor)  # anchor 缺失 = 权威源结构漂移, 直接红
    j = md.index("```json", i)
    k = md.index("```", j + 7)
    return md[j + 7 : k].rstrip("\n")


@pytest.fixture(scope="module")
def protocol_schema() -> str:
    return _protocol_block("### 1.1 JSON Schema")


@pytest.fixture(scope="module")
def protocol_envelope() -> str:
    return _protocol_block("批量信封（`report_usage` 的 input）")


@pytest.fixture(scope="module")
def protocol_f1() -> str:
    return _protocol_block("### F1 正常 completed")


# ---------------------------------------------------- SC-04 逐字一致性 ----

class TestSchemaConsistency:
    def test_agent_usage_report_schema_verbatim(self, protocol_schema):
        """/guide 文档页 schema 段与 mcp-protocol.md §1.1 逐字一致 (S2)。"""
        assert guide_doc.SCHEMA_JSON.strip() == protocol_schema.strip()

    def test_report_usage_envelope_verbatim(self, protocol_envelope):
        """批量信封 schema 与 §1.1 批量信封节逐字一致。"""
        assert guide_doc.ENVELOPE_JSON.strip() == protocol_envelope.strip()

    def test_example_payload_is_f1_fixture_verbatim(self, protocol_f1):
        """示例 payload = §8 F1 fixture 原文, 禁手编 (S3)。"""
        assert guide_doc.EXAMPLE_PAYLOAD.strip() == protocol_f1.strip()

    def test_jsonrpc_example_embeds_f1_verbatim(self, protocol_f1):
        """可整段复制的 JSONRPC 调用, arguments 内嵌 F1 原文不重排。"""
        example = guide_doc.jsonrpc_example()
        assert guide_doc.EXAMPLE_PAYLOAD.strip() in example
        # 整段 (含 JSONRPC 框架) 仍是合法 JSON, 可直接被 MCP 客户端消费
        parsed = json.loads(example)
        assert parsed["method"] == "tools/call"
        assert parsed["params"]["name"] == "report_usage"
        assert parsed["params"]["arguments"] == json.loads(protocol_f1)

    def test_protocol_md_anchors_exist(self):
        """权威源锚点在场 — mcp-protocol.md 结构漂移时显式红, 不静默跳过。"""
        md = PROTOCOL_MD.read_text(encoding="utf-8")
        for anchor in (
            "### 1.1 JSON Schema",
            "批量信封（`report_usage` 的 input）",
            "### F1 正常 completed",
        ):
            assert anchor in md


# ------------------------------------------------------ S3/S4 内容纪律 ----

class TestContentDiscipline:
    def test_constants_are_valid_json(self):
        json.loads(guide_doc.SCHEMA_JSON)
        json.loads(guide_doc.ENVELOPE_JSON)
        json.loads(guide_doc.EXAMPLE_PAYLOAD)

    def test_no_key_material_anywhere(self):
        """S4: key 零出现 — 文档分段与所有代码块不含真实 key 形态。"""
        import inspect

        blob = json.dumps(guide_doc.doc_sections(), ensure_ascii=False)
        blob += guide_doc.jsonrpc_example()
        blob += guide_doc.REFERENCE_IMPL_URL
        assert "sk-" not in blob
        assert "Bearer <key>" in blob  # 占位形态在场 (说明位)
        # hex-64 形态 (openssl rand -hex 32 产物) 不应出现
        assert not re.search(r"\b[0-9a-f]{64}\b", blob)

    def test_five_sections_structure(self):
        """S1 五段式: 概述→认证→接口规格→真实示例→验证步骤。"""
        sections = guide_doc.doc_sections()
        assert [s["id"] for s in sections] == [
            "overview", "auth", "api", "example", "verify",
        ]
        titles = [s["title"] for s in sections]
        assert titles == ["概述", "认证", "接口规格", "真实示例", "验证步骤"]

    def test_schema_section_carries_full_schema(self):
        """P3 checklist: schema 全文嵌入 (含四分项/event_id/status 语义)。"""
        api_items = {s["id"]: s for s in guide_doc.doc_sections()}["api"]["items"]
        code_blocks = [it["code"] for it in api_items if it["type"] == "code"]
        assert any("AgentUsageReport" in c for c in code_blocks)
        assert any("input_cache_hit" in c and "input_cache_miss" in c for c in code_blocks)
        # 幂等/两级判重语义说明在场
        api_text = json.dumps(api_items, ensure_ascii=False)
        assert "两级判重" in api_text and "event_id" in api_text
        assert "duplicated" in api_text and "rejected" in api_text

    def test_reference_impl_link_present(self):
        """S5: 参考实现链接 (hook-usage-reporter) 在概述段。"""
        blob = json.dumps(guide_doc.doc_sections(), ensure_ascii=False)
        assert "hook-usage-reporter" in blob
        assert guide_doc.REFERENCE_IMPL_URL in blob

    def test_verify_section_steps(self):
        """P3 checklist: 验证步骤 = report → summary 回读 → echo 对账。"""
        verify = {s["id"]: s for s in guide_doc.doc_sections()}["verify"]
        text = json.dumps(verify["items"], ensure_ascii=False)
        assert "usage_summary" in text
        assert "usage_report_echo" in text
        assert "duplicated" in text  # 幂等自证步骤

    def test_guide_extraction_point_matches_hook_readme(self):
        """OB-05 防漂移: /guide 提取点措辞与 hook README 同口径。

        判别力自检（双向）:
        - guide 提取点改回 post_llm_call（错误形态）→ 正向断言红;
        - post_llm_call 出现但缺「无 usage」限定（误导形态）→ 限定断言红;
        - hook README 改口径 → README 断言红。
        """
        blob = json.dumps(guide_doc.doc_sections(), ensure_ascii=False)
        # 正向: post_api_request 是唯一被标注为提取点的 hook
        assert "post_api_request 提取点" in blob
        # 反向: 禁止把 post_llm_call 写成提取点（历史错误措辞）
        assert "post_llm_call 提取点" not in blob
        # 限定: post_llm_call 每次出现都带「无 usage」限定（至下一全角闭括号前）
        for m in re.finditer(r"post_llm_call([^）]*)", blob):
            assert "无 usage" in m.group(1), f"post_llm_call 缺「无 usage」限定: {m.group(0)!r}"
        # 同口径: hook README 提取点行 (packages/hook-usage-reporter/README.md:78)
        readme = (REPO_ROOT / "packages" / "hook-usage-reporter" / "README.md").read_text(
            encoding="utf-8"
        )
        assert "`post_api_request` hook（usage 只在此事件，`post_llm_call` 无 usage）" in readme

    def test_protocol_section7_deviation_note(self):
        """OB-05: 协议 §7 偏离留痕在场 — 只加注不换契约。

        判别力: §7 内无 post_api_request（偏离注被删）即红;
        「payload 无 usage」实测依据缺失即红。
        """
        md = PROTOCOL_MD.read_text(encoding="utf-8")
        s7 = md[md.index("## 7. hook 适配规范") : md.index("## 8.")]
        assert "post_api_request" in s7
        assert "post_llm_call` payload 无 usage" in s7
        assert "t_0ea1d8b6" in s7
