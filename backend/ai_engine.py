import json
import os
import urllib.error
import urllib.request
from difflib import SequenceMatcher
from typing import Any, Dict, List


class ReplicationError(RuntimeError):
    pass


def _load_env_file():
    """Load project-local environment variables without external dependencies."""
    env_paths = [
        os.path.join(os.path.dirname(__file__), "..", ".env"),
        os.path.join(os.path.dirname(__file__), ".env")
    ]
    for env_path in env_paths:
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as env_file:
                for line in env_file:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, value = line.split("=", 1)
                        key = key.strip()
                        value = value.strip().strip("'\"")
                        if key and key not in os.environ:
                            os.environ[key] = value


_load_env_file()

VOLC_API_KEY = os.getenv("VOLC_API_KEY") or os.getenv("ARK_API_KEY") or ""
VOLC_MODEL_NAME = os.getenv("VOLC_MODEL_NAME") or os.getenv("VOLC_MODEL_ENDPOINT") or "doubao-seed-2.0-pro"
VOLC_BASE_URL = os.getenv("VOLC_BASE_URL", "https://ark.cn-beijing.volces.com/api/plan/v3")
VOLC_API_URL = f"{VOLC_BASE_URL.rstrip('/')}/chat/completions"

SYSTEM_PROMPT = """你是小红书爆款内容策略师。你的工作不是照抄原文，也不是套用固定爆款模板，而是复用原文有效的内容机制，创作一篇事实可靠、表达全新的同赛道笔记。

请在内部完成以下分析，不要输出分析过程：
1. 识别赛道、目标读者、核心痛点、内容承诺和读者使用场景。
2. 提取原文的爆款机制：标题钩子类型、开场方式、信息密度、情绪曲线、段落节奏、可信度来源和互动方式。
3. 区分可以保留的事实与不可凭空补充的信息。
4. 选择新的叙事视角和结构，创作具有相同传播潜力但措辞与组织方式明显不同的内容。

硬性规则：
- 保留原文主题、受众、关键事实和核心价值，不改变原意。
- 禁止虚构原文没有提供的亲身经历、地点、价格、数据、功效、案例、排名或产品细节。
- 不复用原文或上一版的完整句子、开场、段落结构和互动问题。
- 标题按可见字符计算为 15 至 20 字，具体、有信息量，拒绝空泛标题党。
- 正文首段直接给出痛点、反差或收益；中段提供具体信息；结尾自然引导讨论。
- Emoji 只在有助于扫读时使用，不堆砌；避免“绝了、封神、听我一句劝”等机械套话。
- 标签输出 3 至 5 个，必须与主题直接相关。
"""

DEFAULT_CREATIVE_PROMPT = """请忠实复刻原文的选题价值、受众痛点、信息密度和阅读节奏，同时换一个新的切入角度。正文必须具体、可执行、自然，避免营销腔和空话。"""

OUTPUT_SCHEMA_PROMPT = """只返回一个 JSON 对象，不要返回 Markdown 代码块或额外说明：
{
  "ai_title": "15至20个可见字符的标题",
  "ai_content": "完整正文",
  "ai_tags": ["#话题1", "#话题2", "#话题3"]
}"""


def _visible_length(text: str) -> int:
    return len("".join(text.split()))


def _normalize_text(text: str) -> str:
    return "".join(text.split()).lower()


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, _normalize_text(left), _normalize_text(right)).ratio()


def _extract_json(content: str) -> Dict[str, Any]:
    content = content.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        start = content.find("{")
        end = content.rfind("}")
        if start < 0 or end <= start:
            raise ReplicationError("模型没有返回有效 JSON")
        try:
            parsed = json.loads(content[start:end + 1])
        except json.JSONDecodeError as error:
            raise ReplicationError("模型返回的 JSON 无法解析") from error
    if not isinstance(parsed, dict):
        raise ReplicationError("模型返回结果必须是 JSON 对象")
    return parsed


def _validate_result(
    parsed: Dict[str, Any],
    original_title: str,
    original_content: str,
    previous_title: str,
    previous_content: str
) -> List[str]:
    errors = []
    title = parsed.get("ai_title")
    content = parsed.get("ai_content")
    tags = parsed.get("ai_tags")
    if not isinstance(title, str) or not title.strip():
        errors.append("ai_title 必须是非空字符串")
    elif not 15 <= _visible_length(title) <= 20:
        errors.append("ai_title 必须为 15 至 20 个可见字符")
    if not isinstance(content, str) or len(content.strip()) < 80:
        errors.append("ai_content 必须是至少 80 字的完整正文")
    if not isinstance(tags, list) or not 3 <= len(tags) <= 5 or not all(isinstance(tag, str) and tag.strip() for tag in tags):
        errors.append("ai_tags 必须包含 3 至 5 个非空字符串")
    if isinstance(title, str) and _similarity(title, original_title) > 0.82:
        errors.append("标题与原文过于相似")
    if isinstance(content, str) and _similarity(content, original_content) > 0.72:
        errors.append("正文与原文过于相似")
    if isinstance(title, str) and previous_title and _similarity(title, previous_title) > 0.82:
        errors.append("标题与上一版过于相似")
    if isinstance(content, str) and previous_content and _similarity(content, previous_content) > 0.72:
        errors.append("正文与上一版过于相似")
    return errors


def _normalize_result(parsed: Dict[str, Any], original_images: List[str]) -> Dict[str, Any]:
    tags = []
    for raw_tag in parsed["ai_tags"]:
        tag = raw_tag.strip()
        normalized = tag if tag.startswith("#") else f"#{tag}"
        if normalized not in tags:
            tags.append(normalized)
    return {
        "ai_title": parsed["ai_title"].strip(),
        "ai_content": parsed["ai_content"].strip(),
        "ai_tags": tags,
        "ai_images": original_images,
        "engine": "volcengine"
    }


def _call_volcengine(messages: List[Dict[str, str]], temperature: float = 0.82) -> str:
    if not VOLC_API_KEY:
        raise ReplicationError("未配置火山方舟 API Key，无法进行真实复刻")
    payload = {
        "model": VOLC_MODEL_NAME,
        "messages": messages,
        "temperature": temperature,
        "response_format": {"type": "json_object"}
    }
    request = urllib.request.Request(
        VOLC_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {VOLC_API_KEY}"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise ReplicationError(f"火山方舟请求失败（HTTP {error.code}）：{detail}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise ReplicationError(f"无法连接火山方舟：{error}") from error
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ReplicationError("火山方舟返回结构异常") from error


def replicate_with_volcengine(
    original_title: str,
    original_content: str,
    custom_prompt: str = "",
    previous_title: str = "",
    previous_content: str = "",
    original_images: List[str] = None
) -> Dict[str, Any]:
    if not original_title.strip() or not original_content.strip():
        raise ReplicationError("原文标题和正文不能为空")

    creative_prompt = custom_prompt.strip() or DEFAULT_CREATIVE_PROMPT
    previous_version = ""
    if previous_title or previous_content:
        previous_version = (
            f"\n\n【上一版标题】\n{previous_title}\n"
            f"【上一版正文】\n{previous_content}\n"
            "本次必须明显更换标题钩子、开场、信息顺序和互动方式，同时保持原文事实边界。"
        )
    user_content = (
        f"【原文标题】\n{original_title}\n\n"
        f"【原文正文】\n{original_content}"
        f"{previous_version}\n\n"
        f"【用户创作要求】\n{creative_prompt}\n\n"
        f"{OUTPUT_SCHEMA_PROMPT}"
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content}
    ]

    parsed = _extract_json(_call_volcengine(messages))
    errors = _validate_result(parsed, original_title, original_content, previous_title, previous_content)
    if errors:
        repair_messages = messages + [
            {"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)},
            {
                "role": "user",
                "content": (
                    "上一个结果未通过校验：\n- " + "\n- ".join(errors) +
                    "\n请在不虚构事实的前提下修正全部问题。" + OUTPUT_SCHEMA_PROMPT
                )
            }
        ]
        parsed = _extract_json(_call_volcengine(repair_messages, temperature=0.65))
        remaining_errors = _validate_result(parsed, original_title, original_content, previous_title, previous_content)
        if remaining_errors:
            raise ReplicationError("模型结果未通过质量校验：" + "；".join(remaining_errors))

    return _normalize_result(parsed, original_images or [])
