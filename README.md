# RED AI Studio

小红书爆款内容采集、AI 复刻、人工审核和 Chrome 自动发布工具。

## 功能概览

- 从小红书详情页采集标题、正文、作者、点赞数和原图。
- 在列表页选择点赞最高的笔记，并读取其详情内容。
- 使用兼容 OpenAI 协议的模型生成原创标题、正文和话题。
- 使用生图模型生成原创配图，并保存到本地 `backend/generated_media/`。
- 在 Web 控制台编辑提示词和 AI 结果，审核后加入发布队列。
- Chrome 插件将 AI 配图、标题、正文和话题填入小红书创作者中心。
- 多个 `#话题` 会逐个输入，逐个选择候选弹窗首项。

## 项目结构

```text
backend/             Python 标准库后端、SQLite、模型调用和测试
frontend/            Web 控制台静态页面
extension/           Chrome Manifest V3 插件
docker-compose.yml   Docker 启动配置
.env.example         环境变量示例
```

## 快速启动

### 1. 准备环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少填写真实的 `VOLC_API_KEY`：

```dotenv
VOLC_API_KEY=你的_api_key
VOLC_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
VOLC_MODEL_NAME=doubao-seed-2.0-pro
VOLC_IMAGE_MODEL_NAME=doubao-seedream-5.0-lite
VOLC_IMAGE_SIZE=2K
PUBLIC_BASE_URL=http://localhost:8888
```

### 2. 启动后端和前端

```bash
docker compose up -d --build
```

打开 [http://localhost:8888](http://localhost:8888)。健康检查：

```bash
curl http://localhost:8888/api/health
```

停止服务：

```bash
docker compose down
```

## 模型配置

控制台顶部的“模型配置”面板支持配置：

- `Base URL`
- `API Key`
- 文本模型 `model`
- 生图模型 `image model`
- 生图尺寸

配置优先级为：

```text
页面保存的配置 > .env / Docker 环境变量 > 代码默认值
```

API Key 在页面只显示为 `********`，不会通过配置查询接口返回明文。点击“恢复 `.env` 默认”可清除页面配置。页面配置保存在 SQLite 的 `app_settings` 表中；当前本地数据库文件包含配置数据，请妥善保护 `backend/data.db`，不要提交到公开仓库。

修改 `.env` 后需要重新构建或重启容器：

```bash
docker compose up -d --build
```

## 使用流程

1. 在小红书主站打开笔记详情页，或打开包含笔记卡片的列表页。
2. 使用插件“抓取当前页面爆款图文”。详情页抓当前打开的笔记；列表页按点赞数选择最高的一篇并读取详情。
3. 在控制台待审核区域检查 AI 标题、正文、话题和原创配图。
4. 可修改提示词或生成结果，点击“审核通过，加入发布队列”。
5. 在 Chrome 插件中点击“在创作者中心执行自动化发布”。
6. 插件只使用 `ai_images`，没有 AI 配图时会停止，不会回退发布原素材图片。

## Chrome 插件安装

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `extension/` 目录。
5. 打开小红书主站或创作者中心页面使用插件。

修改插件代码后，需要在扩展管理页点击“重新加载”，并刷新已经打开的小红书页面。

插件后台默认连接：

```text
http://localhost:8888/api
```

## 主要 API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/model-config` | 获取当前生效模型配置（Key 掩码） |
| `PUT` | `/api/model-config` | 保存模型配置或传 `{"reset": true}` 恢复 `.env` |
| `GET` | `/api/posts` | 获取素材和审核记录 |
| `POST` | `/api/posts/scrape` | 写入一条采集素材 |
| `POST` | `/api/posts/{id}/replicate` | 调用模型生成复刻内容和配图 |
| `PUT` | `/api/posts/{id}/review` | 保存人工修改并审核 |
| `GET` | `/api/extension/pending-publish` | 获取插件待发布队列 |
| `POST` | `/api/extension/update-status` | 插件回传发布状态 |
| `GET` | `/media/generated/{filename}` | 读取本地生成图片 |

## 测试和检查

```bash
python -m unittest backend.test_ai_engine backend.test_database -v
node --check frontend/app.js
node --check extension/content_script.js
node --check extension/background.js
git diff --check
```

## 常见问题

### 页面看不到新采集内容

确认后端在线，并检查：

```bash
curl http://localhost:8888/api/posts
```

插件代码更新后，重新加载扩展并刷新小红书页面。

### 复刻没有生成配图

检查模型配置中的生图模型、Base URL 和 API Key。没有 `ai_images` 的任务不能进入插件图片发布流程，需要重新生成配图。

### 火山 API 无法连接

确认 Base URL 不要重复拼接 `/chat/completions` 或 `/images/generations`，并确认 API Key 对应的模型有调用权限。修改页面配置后直接保存即可；修改 `.env` 后重启容器。

### 发布状态是否代表小红书已发布成功

当前 `PUBLISHED` 表示插件已找到发布按钮并回传状态，尚未通过小红书官方接口确认最终结果。遇到平台校验、敏感词或网络错误时，应以创作者中心页面实际结果为准。
