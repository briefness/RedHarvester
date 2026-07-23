import sqlite3
import unittest

from backend import database


class ReviewPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.original_connection = database._DB_CONN
        database._DB_CONN = sqlite3.connect(":memory:", check_same_thread=False)
        database._DB_CONN.row_factory = sqlite3.Row
        database.init_db()
        self.post_id = database.add_post(
            "原文标题",
            "原文正文内容足够长",
            original_images=["https://example.com/original.jpg"]
        )
        database.update_ai_replication(
            self.post_id,
            "AI 标题",
            "AI 正文内容足够长",
            ["#标签"],
            ["http://localhost:8888/media/generated/1.jpg"]
        )

    def tearDown(self):
        database._DB_CONN.close()
        database._DB_CONN = self.original_connection

    def test_review_without_images_preserves_generated_images(self):
        database.update_human_review(
            self.post_id,
            "APPROVED",
            ai_title="人工修改标题",
            ai_content="人工修改正文内容足够长",
            ai_tags=["#新标签"]
        )

        post = database.get_post_by_id(self.post_id)
        self.assertEqual(post["status"], "APPROVED")
        self.assertEqual(post["ai_images"], ["http://localhost:8888/media/generated/1.jpg"])

    def test_review_with_images_replaces_generated_images(self):
        replacement = ["http://localhost:8888/media/generated/2.jpg"]
        database.update_human_review(
            self.post_id,
            "APPROVED",
            ai_title="人工修改标题",
            ai_content="人工修改正文内容足够长",
            ai_tags=["#新标签"],
            ai_images=replacement
        )

        self.assertEqual(database.get_post_by_id(self.post_id)["ai_images"], replacement)

    def test_model_config_overrides_persist_and_clear(self):
        overrides = {
            "base_url": "https://example.com/v1",
            "api_key": "custom-key",
            "model": "text-model"
        }
        database.save_model_config_overrides(overrides)
        self.assertEqual(database.get_model_config_overrides(), overrides)

        database.clear_model_config_overrides()
        self.assertEqual(database.get_model_config_overrides(), {})


if __name__ == "__main__":
    unittest.main()
