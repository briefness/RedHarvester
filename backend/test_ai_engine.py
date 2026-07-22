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
        self.assertIn("语气更克制", messages[1]["content"])
        self.assertIn("只返回一个 JSON 对象", messages[1]["content"])
        self.assertEqual(result["ai_images"], ["https://example.com/original.jpg"])
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
    def test_rejects_result_that_remains_invalid(self, call_model):
        invalid = {"ai_title": "太短", "ai_content": "内容太短", "ai_tags": []}
        call_model.return_value = json.dumps(invalid, ensure_ascii=False)

        with self.assertRaises(ai_engine.ReplicationError):
            ai_engine.replicate_with_volcengine(self.original_title, self.original_content)

        self.assertEqual(call_model.call_count, 2)


if __name__ == "__main__":
    unittest.main()
