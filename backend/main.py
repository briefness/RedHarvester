#!/usr/bin/env python3
"""
RED AI Studio - 纯 Python 标准库后端服务 (Zero Dependencies HTTP Server)
无第三方依赖，支持 Docker 容器与本地原生直接启动
包含：REST API 接口、SQLite 内存/持久化存取、火山 AI 复刻引擎及前端静态托管
"""

import http.server
import socketserver
import json
import sys
import os
import urllib.parse
import urllib.error
import urllib.request
import base64
import binascii
import mimetypes
import secrets

# 1. 根治模块导入路径：强行锁定 backend 所在目录绝对路径至 sys.path 首位
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# 2. 根治前端静态目录：使用绝对路径计算
FRONTEND_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend"))

from database import init_db, add_post, get_posts, get_post_by_id, update_ai_replication, update_human_review
from ai_engine import DEFAULT_CREATIVE_PROMPT, ReplicationError, replicate_with_volcengine

PORT = int(os.getenv("PORT", 8000))
CONTENT_NOISE_MARKERS = (
    "ICP备", "营业执照", "公网安备", "增值电信业务经营许可证", "医疗器械网络交易服务",
    "互联网药品信息服务资格证书", "违法不良信息举报电话", "网络文化经营许可证", "网信算备"
)
GENERATED_MEDIA_DIR = os.path.join(BACKEND_DIR, "generated_media")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8888").rstrip("/")
os.makedirs(GENERATED_MEDIA_DIR, exist_ok=True)


def persist_generated_images(post_id, image_urls):
    """Persist temporary Seedream URLs before their signed links expire."""
    persisted = []
    created_files = []
    try:
        for index, image_url in enumerate(image_urls or []):
            content_type = "image/jpeg"
            if isinstance(image_url, str) and image_url.startswith("data:image/"):
                header, encoded = image_url.split(",", 1)
                content_type = header[5:].split(";", 1)[0]
                image_bytes = base64.b64decode(encoded, validate=True)
            elif isinstance(image_url, str) and image_url.startswith(("https://", "http://")):
                request = urllib.request.Request(image_url, headers={"User-Agent": "RED-AI-Studio/1.0"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    content_type = response.headers.get_content_type()
                    image_bytes = response.read(20 * 1024 * 1024 + 1)
            else:
                raise ReplicationError("生图返回了不支持的图片地址")

            if not content_type.startswith("image/"):
                raise ReplicationError("生图返回内容不是图片")
            if not image_bytes or len(image_bytes) > 20 * 1024 * 1024:
                raise ReplicationError("生成图片大小超出限制")

            extension = mimetypes.guess_extension(content_type) or ".jpg"
            filename = f"{post_id}-{index}-{secrets.token_hex(8)}{extension}"
            filepath = os.path.join(GENERATED_MEDIA_DIR, filename)
            with open(filepath, "wb") as media_file:
                media_file.write(image_bytes)
            created_files.append(filepath)
            persisted.append(f"{PUBLIC_BASE_URL}/media/generated/{filename}")
    except (ValueError, binascii.Error, urllib.error.URLError, TimeoutError, OSError) as error:
        for filepath in created_files:
            try:
                os.remove(filepath)
            except OSError:
                pass
        raise ReplicationError(f"生成图片保存失败：{error}") from error
    return persisted


def clean_scraped_content(content):
    if not isinstance(content, str):
        return ""
    lines = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if line and line not in lines and not any(marker in line for marker in CONTENT_NOISE_MARKERS):
            lines.append(line)
    return "\n".join(lines)

# 3. 初始化数据库与种子数据
init_db()

try:
    existing = get_posts()
    if not existing:
        p1 = add_post(
            original_title="新手必看！爆款小红书文案的逆向拆解法！",
            original_content="很多小白做小红书一直没流量，其实就是没掌握爆款痛点抓取。今天教大家如何用3招逆向拆解对标账号，直接把互动量拉满！第一招：抓反常识；第二招：情绪价值钩子；第三招：金字塔结构列干货。",
            author="营销老司机",
            likes=38200,
            original_images=[
                "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800",
                "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800"
            ],
            source_url="https://www.xiaohongshu.com/explore/demo1"
        )
        update_ai_replication(
            post_id=p1,
            ai_title="🔥小白逆袭！爆款小红书拆解公式，建议低调收藏！",
            ai_content="把真相说透！为什么你做小红书总是不出单？原因就在这里！👇\n\n💡【爆款3要素】\n1️⃣ 视觉反差钩子\n2️⃣ 情绪爆发点（引共鸣）\n3️⃣ 落地避坑指南\n\n赶紧【收藏】起来，照着直接套用！👇",
            ai_tags=["#小红书干货", "#爆款拆解", "#AI高效赋能", "#运营避坑指南"],
            ai_images=[
                "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800",
                "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800"
            ]
        )
except Exception as e:
    print(f"[Warn] Seed data error: {e}")

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

class RequestHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        # 优化静默日志，防止控制台刷屏
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format%args))

    def _send_json(self, data, code=200):
        try:
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_file(self, filepath, mime_type="text/html"):
        try:
            if os.path.exists(filepath):
                with open(filepath, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_error(404, f"File Not Found: {filepath}")
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            # 1. API: 健康检查
            if path == "/api/health":
                return self._send_json({"status": "ok", "service": "RED AI Studio Pure Stdlib Backend"})

            if path == "/api/generation-config":
                return self._send_json({"default_prompt": DEFAULT_CREATIVE_PROMPT})

            # 2. API: 获取帖子列表
            if path == "/api/posts" or path == "/api/posts/":
                query = urllib.parse.parse_qs(parsed.query)
                status_filter = query.get("status", [None])[0]
                posts = get_posts(status=status_filter)
                return self._send_json(posts)

            # 3. API: 获取单个帖子
            if path.startswith("/api/posts/"):
                parts = path.split("/")
                if len(parts) == 4 and parts[3].isdigit():
                    post_id = int(parts[3])
                    post = get_post_by_id(post_id)
                    if post:
                        return self._send_json(post)
                    return self._send_json({"error": "Post not found"}, 404)

            # 4. API: 插件轮询待发布队列
            if path == "/api/extension/pending-publish":
                approved_posts = get_posts(status="APPROVED")
                return self._send_json({"count": len(approved_posts), "posts": approved_posts})

            if path.startswith("/media/generated/"):
                filename = urllib.parse.unquote(path.removeprefix("/media/generated/"))
                if not filename or "/" in filename or "\\" in filename or filename.startswith("."):
                    return self.send_error(404, "Not Found")
                filepath = os.path.join(GENERATED_MEDIA_DIR, filename)
                mime_type = mimetypes.guess_type(filepath)[0] or "application/octet-stream"
                return self._send_file(filepath, mime_type)

            # 5. 静态前端托管
            if path == "/" or path == "/index.html":
                return self._send_file(os.path.join(FRONTEND_DIR, "index.html"), "text/html; charset=utf-8")
            elif path == "/static/style.css" or path == "/style.css":
                return self._send_file(os.path.join(FRONTEND_DIR, "style.css"), "text/css; charset=utf-8")
            elif path == "/static/app.js" or path == "/app.js":
                return self._send_file(os.path.join(FRONTEND_DIR, "app.js"), "application/javascript; charset=utf-8")

            self.send_error(404, "Not Found")
        except Exception as e:
            print(f"[Error in do_GET]: {e}")
            self._send_json({"error": str(e)}, 500)

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(length) if length > 0 else b'{}'
            
            try:
                req_data = json.loads(body_bytes.decode('utf-8'))
            except Exception:
                req_data = {}

            # 1. API: 录入/抓取爆款
            if path == "/api/posts/scrape":
                title = req_data.get("title", "")
                content = clean_scraped_content(req_data.get("content", ""))
                author = req_data.get("author", "匿名")
                likes = req_data.get("likes", 8888)
                images = req_data.get("images", [])
                source_url = req_data.get("source_url", "")

                if not isinstance(title, str) or not title.strip():
                    return self._send_json({"error": "title is required"}, 400)
                if len(content) < 8:
                    return self._send_json({"error": "未识别到有效笔记正文，请打开具体笔记详情后重试"}, 400)

                post_id = add_post(title, content, author, likes, images, source_url)
                return self._send_json({"status": "success", "post_id": post_id, "message": "爆款录入成功"})

            # 2. API: 触发火山 AI 复刻
            if path.startswith("/api/posts/") and path.endswith("/replicate"):
                parts = path.split("/")
                if len(parts) == 5 and parts[3].isdigit():
                    post_id = int(parts[3])
                    post = get_post_by_id(post_id)
                    if not post:
                        return self._send_json({"error": "Post not found"}, 404)
                    
                    custom_prompt = req_data.get("prompt", "")
                    if not isinstance(custom_prompt, str):
                        return self._send_json({"error": "prompt must be a string"}, 400)
                    if len(custom_prompt) > 20000:
                        return self._send_json({"error": "prompt is too long"}, 400)

                    previous_title = req_data.get("previous_title")
                    previous_content = req_data.get("previous_content")
                    if previous_title is not None and not isinstance(previous_title, str):
                        return self._send_json({"error": "previous_title must be a string"}, 400)
                    if previous_content is not None and not isinstance(previous_content, str):
                        return self._send_json({"error": "previous_content must be a string"}, 400)
                    if len(previous_title or "") > 200 or len(previous_content or "") > 50000:
                        return self._send_json({"error": "previous version is too long"}, 400)

                    try:
                        ai_res = replicate_with_volcengine(
                            post["original_title"],
                            post["original_content"],
                            custom_prompt=custom_prompt,
                            previous_title=previous_title if previous_title is not None else post.get("ai_title") or "",
                            previous_content=previous_content if previous_content is not None else post.get("ai_content") or "",
                            original_images=post.get("original_images") or [],
                            generate_images=req_data.get("generate_images", True) is True
                        )
                        if ai_res.get("ai_images"):
                            try:
                                ai_res["ai_images"] = persist_generated_images(post_id, ai_res["ai_images"])
                            except ReplicationError as error:
                                ai_res["ai_images"] = []
                                ai_res["image_error"] = str(error)
                    except ReplicationError as error:
                        print(f"[ReplicationError] post_id={post_id}: {error}", flush=True)
                        return self._send_json({"error": str(error), "engine": "volcengine"}, 502)
                    update_ai_replication(post_id, ai_res["ai_title"], ai_res["ai_content"], ai_res["ai_tags"], ai_res["ai_images"])
                    return self._send_json({"status": "success", "data": ai_res})

            # 3. API: 插件发布完成状态回调
            if path == "/api/extension/update-status":
                raw_post_id = req_data.get("post_id")
                status = req_data.get("status", "PUBLISHED")
                if raw_post_id is not None:
                    post_id = int(raw_post_id)
                    new_status = "PUBLISHED" if status == "PUBLISHED" else "APPROVED"
                    update_human_review(post_id, status=new_status)
                    print(f"[RED AI Backend] 成功将任务 #{post_id} 数据库状态更新为 [{new_status}]")
                    return self._send_json({"status": "success", "post_id": post_id, "current_status": new_status})

            self.send_error(404, "API Path Not Found")
        except Exception as e:
            print(f"[Error in do_POST]: {e}")
            self._send_json({"error": str(e)}, 500)

    def do_PUT(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(length) if length > 0 else b'{}'
            req_data = json.loads(body_bytes.decode('utf-8'))

            # API: 人工审核更新
            if path.startswith("/api/posts/") and path.endswith("/review"):
                parts = path.split("/")
                if len(parts) == 5 and parts[3].isdigit():
                    post_id = int(parts[3])
                    status = req_data.get("status", "APPROVED")
                    ai_title = req_data.get("ai_title")
                    ai_content = req_data.get("ai_content")
                    ai_tags = req_data.get("ai_tags")
                    ai_images = req_data.get("ai_images")

                    update_human_review(post_id, status, ai_title, ai_content, ai_tags, ai_images)
                    return self._send_json({"status": "success", "post_id": post_id, "new_status": status})

            self.send_error(404, "API Path Not Found")
        except Exception as e:
            print(f"[Error in do_PUT]: {e}")
            self._send_json({"error": str(e)}, 500)

def run_server():
    # 根治关键点：必须明确绑定 '0.0.0.0' 以允许 Docker 端口转发 IPv4 全局监听
    server_address = ('0.0.0.0', PORT)
    httpd = ReusableTCPServer(server_address, RequestHandler)
    print(f"🚀 [RED AI Studio Backend] Listening on 0.0.0.0:{PORT} (accessible outside container)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
