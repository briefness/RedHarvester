import json
import unittest
from unittest.mock import patch

from backend import ai_engine


class ReplicationTests(unittest.TestCase):
    def setUp(self):
        self.original_title = "新手必看！爆款小红书文案的逆向拆解法！"
        self.original_content = (
            "很多小白做小红书一直没流量，其实就是没掌握爆款痛点抓取。"
            "今天教大家如何用3招逆向拆解对标账号：抓反常识、情绪价值钩子、金字塔结构列干货。"
        )
        self.valid_result = {
            "content_dna": {
                "niche": "小红书内容运营",
                "target_reader": "缺少流量的新手创作者",
                "core_pain": "无法拆解对标内容的有效机制",
                "core_value": "获得可执行的三步拆解方法",
                "verified_facts": ["方法包含反常识切入", "方法包含情绪钩子", "方法使用金字塔结构"],
                "hook_mechanism": "直指低流量痛点并承诺给出方法",
                "structure": ["提出痛点", "拆解三步方法", "引导讨论"],
                "tone": "直接、实用、面向新手"
            },
            "ai_title": "新手也能复制的高互动文案拆解方法",
            "ai_content": (
                "小红书没有互动，问题往往不是更新次数少，而是开头没有立刻回应读者需求。\n\n"
                "第一步先提炼原文最反常识的结论，让读者马上知道继续阅读能获得什么。"
                "第二步把方法拆成清晰步骤，每一步只解决一个问题，并给出能够直接执行的动作。"
                "第三步重新检查标题、前三行和结尾是否围绕同一个痛点，避免信息分散。\n\n"
                "你写文案时最容易卡在哪一步？欢迎留下具体场景一起拆解。"
            ),
            "ai_tags": ["小红书运营", "文案拆解", "内容创作"]
        }

    @patch("backend.ai_engine._call_volcengine")
    def test_custom_prompt_is_additional_and_images_are_preserved(self, call_model):
        call_model.return_value = json.dumps(self.valid_result, ensure_ascii=False)

        result = ai_engine.replicate_with_volcengine(
            self.original_title,
            self.original_content,
            custom_prompt="语气更克制",
            original_images=["https://example.com/original.jpg"]
        )

        messages = call_model.call_args.args[0]
        self.assertEqual(messages[0]["content"], ai_engine.SYSTEM_PROMPT)
        user_content = messages[1]["content"]
        user_text = user_content[0]["text"] if isinstance(user_content, list) else user_content
        self.assertIn("语气更克制", user_text)
        self.assertIn("只返回一个 JSON 对象", user_text)
        self.assertEqual(user_content[-1]["image_url"]["url"], "https://example.com/original.jpg")
        self.assertEqual(result["ai_images"], [])
        self.assertEqual(result["engine"], "volcengine")
        self.assertEqual(result["ai_tags"][0], "#小红书运营")

    @patch("backend.ai_engine._call_volcengine")
    def test_invalid_result_is_repaired_once(self, call_model):
        invalid = {"ai_title": "太短", "ai_content": "内容太短", "ai_tags": []}
        call_model.side_effect = [
            json.dumps(invalid, ensure_ascii=False),
            json.dumps(self.valid_result, ensure_ascii=False)
        ]

        result = ai_engine.replicate_with_volcengine(self.original_title, self.original_content)

        self.assertEqual(call_model.call_count, 2)
        self.assertEqual(result["ai_title"], self.valid_result["ai_title"])
        repair_messages = call_model.call_args.args[0]
        self.assertIn("未通过校验", repair_messages[-1]["content"])

    @patch("backend.ai_engine._call_volcengine")
    def test_image_led_note_extracts_facts_before_generation(self, call_model):
        call_model.side_effect = [
            "- 地点：上海\n- 预算：300万\n- 入学年份：2027年",
            json.dumps(self.valid_result, ensure_ascii=False)
        ]

        ai_engine.replicate_with_volcengine(
            self.original_title,
            "#上海买房 #上海学区",
            original_images=["https://example.com/original.jpg"]
        )

        self.assertEqual(call_model.call_count, 2)
        generation_messages = call_model.call_args.args[0]
        self.assertIn("【图片识别事实】", generation_messages[1]["content"])
        self.assertIn("预算：300万", generation_messages[1]["content"])

    @patch("backend.ai_engine._call_volcengine")
    def test_rejects_result_that_remains_invalid(self, call_model):
        invalid = {"ai_title": "太短", "ai_content": "内容太短", "ai_tags": []}
        call_model.return_value = json.dumps(invalid, ensure_ascii=False)

        with self.assertRaises(ai_engine.ReplicationError):
            ai_engine.replicate_with_volcengine(self.original_title, self.original_content)

        self.assertEqual(call_model.call_count, 2)

    @patch("backend.ai_engine._call_volcengine")
    def test_unparseable_json_is_repaired_once(self, call_model):
        call_model.side_effect = [
            "这是一段没有 JSON 结构的模型输出。",
            json.dumps(self.valid_result, ensure_ascii=False)
        ]

        result = ai_engine.replicate_with_volcengine(self.original_title, self.original_content)

        self.assertEqual(result["ai_title"], self.valid_result["ai_title"])
        self.assertEqual(call_model.call_count, 2)
        repair_request = call_model.call_args.args[0]
        self.assertIn("JSON", repair_request[-1]["content"])

    @patch("backend.ai_engine.urllib.request.urlopen")
    def test_transient_timeout_is_retried_once(self, urlopen):
        valid_response = unittest.mock.MagicMock()
        valid_response.__enter__.return_value.read.return_value = json.dumps({
            "choices": [{"message": {"content": json.dumps(self.valid_result, ensure_ascii=False)}}]
        }, ensure_ascii=False).encode("utf-8")
        urlopen.side_effect = [TimeoutError("temporary timeout"), valid_response]

        content = ai_engine._call_volcengine([{"role": "user", "content": "test"}])

        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(json.loads(content)["ai_title"], self.valid_result["ai_title"])
        request_payload = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(request_payload["thinking"], {"type": "disabled"})

    @patch("backend.ai_engine.urllib.request.urlopen")
    def test_image_generation_reads_url_response(self, urlopen):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            "data": [{"url": "https://example.com/generated.jpg"}]
        }).encode("utf-8")
        urlopen.return_value = response

        images = ai_engine._call_image_generation("生成一张原创配图")

        self.assertEqual(images, ["https://example.com/generated.jpg"])
        request = urlopen.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/images/generations"))
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["model"], ai_engine.VOLC_IMAGE_MODEL_NAME)
        self.assertEqual(payload["response_format"], "url")

    @patch("backend.ai_engine._call_image_generation")
    @patch("backend.ai_engine._call_volcengine")
    def test_replicate_uses_generated_images_only(self, call_model, call_images):
        call_model.return_value = json.dumps(self.valid_result, ensure_ascii=False)
        call_images.return_value = ["https://example.com/generated.jpg"]

        result = ai_engine.replicate_with_volcengine(
            self.original_title,
            self.original_content,
            original_images=["https://example.com/original.jpg"],
            generate_images=True
        )

        self.assertEqual(result["ai_images"], ["https://example.com/generated.jpg"])
        self.assertNotIn("https://example.com/original.jpg", result["ai_images"])
        call_images.assert_called_once()

    @patch("backend.ai_engine.get_model_config_overrides")
    def test_model_config_view_prefers_custom_values_and_masks_key(self, get_overrides):
        get_overrides.return_value = {
            "base_url": "https://custom.example/v1",
            "api_key": "secret-value",
            "model": "custom-text-model"
        }

        config = ai_engine.get_model_config_view()

        self.assertEqual(config["base_url"], "https://custom.example/v1")
        self.assertEqual(config["model"], "custom-text-model")
        self.assertEqual(config["api_key_masked"], ai_engine.MASKED_API_KEY)
        self.assertNotIn("secret-value", str(config))


if __name__ == "__main__":
    unittest.main()
