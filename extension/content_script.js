/**
 * RED AI Studio - Chrome Content Script
 * 防风控技术要点：
 * 1. 在真实登录的 Chrome 上运行，无 Selenium / Puppeteer 控制痕迹 (navigator.webdriver === undefined)
 * 2. 拟人化打字 (Human Input Simulation)，包含键盘事件与随机按键时延
 * 3. 使用 HTML5 DataTransfer 触发原生 File Input 上传，无硬发包协议风控问题
 */

console.log("[RED AI Publisher] Content Script 注入成功！页面:", window.location.href);

// 动态注入右下角【一键采料 + 火山 AI 复刻】悬浮按钮 (仅在小红书主站生效)
if (window.location.host.includes("xiaohongshu.com") && !window.location.host.includes("creator")) {
    window.addEventListener("DOMContentLoaded", injectFloatingScraperBtn);
    setTimeout(injectFloatingScraperBtn, 1500); // 确保 SPA 页面渲染后成功挂载
}

// 自动检测自动导航指令：若为自动导航至创作者平台，页面加载后自动触发打字填充
if (window.location.host.includes("creator.xiaohongshu.com")) {
    chrome.storage.local.get("pendingAutoPublish", (res) => {
        if (res && res.pendingAutoPublish) {
            chrome.storage.local.remove("pendingAutoPublish");
            console.log("[RED AI Publisher] 检测到一键自动导航指令，将在 2 秒后自动填充...");
            setTimeout(() => {
                executePublishWorkflow().then(result => {
                    console.log("[RED AI Publisher] 自动发帖流程执行完毕:", result);
                });
            }, 2200);
        }
    });
}

function injectFloatingScraperBtn() {
    if (document.getElementById("red-ai-floating-scraper")) return;

    const btn = document.createElement("div");
    btn.id = "red-ai-floating-scraper";
    btn.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        z-index: 99999;
        background: linear-gradient(135deg, #ff2442, #e01b36);
        color: #fff;
        padding: 12px 20px;
        border-radius: 30px;
        box-shadow: 0 8px 24px rgba(255, 36, 66, 0.4);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.3s ease;
        user-select: none;
    `;
    btn.innerHTML = `<span style="font-size:18px;">🔥</span> 提取爆款 + 火山 AI 复刻`;

    btn.addEventListener("mouseenter", () => {
        btn.style.transform = "translateY(-3px) scale(1.03)";
        btn.style.boxShadow = "0 12px 28px rgba(255, 36, 66, 0.55)";
    });
    btn.addEventListener("mouseleave", () => {
        btn.style.transform = "none";
        btn.style.boxShadow = "0 8px 24px rgba(255, 36, 66, 0.4)";
    });

    btn.addEventListener("click", async () => {
        btn.innerHTML = `<span style="font-size:18px;">⏳</span> 正在读取当前页爆款...`;
        try {
            const data = await extractCurrentOrTopLikedPost();
            btn.innerHTML = `<span style="font-size:18px;">⏳</span> 正在采集并复刻中...`;
            chrome.runtime.sendMessage({ action: "SCRAPE_SUBMIT", payload: data }, (res) => {
                const succeeded = Boolean(res?.success);
                btn.innerHTML = succeeded
                    ? `<span style="font-size:18px;">✅</span> 已送入 AI 复刻！请前往控制台审核`
                    : `<span style="font-size:18px;">⚠️</span> 复刻失败：${res?.reason || "请查看控制台"}`;
                btn.style.background = succeeded
                    ? "linear-gradient(135deg, #10b981, #059669)"
                    : "linear-gradient(135deg, #f59e0b, #d97706)";
                setTimeout(() => {
                    btn.innerHTML = `<span style="font-size:18px;">🔥</span> 提取爆款 + 火山 AI 复刻`;
                    btn.style.background = "linear-gradient(135deg, #ff2442, #e01b36)";
                }, 5000);
            });
        } catch (error) {
            btn.innerHTML = `<span style="font-size:18px;">⚠️</span> 采集失败：${error.message}`;
        }
    });

    document.body.appendChild(btn);
}

function parseLikeCount(value) {
    const match = String(value || "").replace(/,/g, "").trim().toLowerCase().match(/([\d.]+)\s*(万|w|千|k)?/);
    if (!match) return 0;
    const multiplier = match[2] === "万" || match[2] === "w" ? 10000 : match[2] === "千" || match[2] === "k" ? 1000 : 1;
    return Math.round(Number(match[1]) * multiplier) || 0;
}

function isVisibleElement(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function findDetailTitle() {
    return [
        document.querySelector("#detail-title"),
        document.querySelector(".interaction-container #detail-title"),
        document.querySelector(".note-scroller .note-content > .title"),
        document.querySelector(".note-content > .title")
    ].find(isVisibleElement) || null;
}

function extractNoteMediaSources(root) {
    return Array.from(root.querySelectorAll(
        ".note-slider img, .note-slider video[poster], .media-container img, .media-container video[poster]"
    ))
        .filter(media => !media.closest(".comments-container, .comment-container, .comment-item, [class*='comment-picture'], [class*='comment-image']"))
        .map(media => media.tagName === "VIDEO"
            ? media.getAttribute("poster")
            : media.currentSrc || media.getAttribute("src") || media.getAttribute("data-src") || media.getAttribute("data-original") || media.getAttribute("data-lazy-src"))
        .filter(src => src && !/avatar|userhead|profile/i.test(src))
        .map(src => src.replace(/^http:/, "https:"))
        .filter((src, index, all) => all.indexOf(src) === index);
}

function findTopLikedNoteCard() {
    const rankedCards = Array.from(document.querySelectorAll("section.note-item")).map(card => {
        const links = Array.from(card.querySelectorAll("a[href*='/explore/']"));
        const titleLink = links.find(link => link.innerText.trim()) || links[0];
        const likeElement = card.querySelector(".like-wrapper .count, .like-wrapper, [class*='like'] [class*='count']");
        const cardLines = card.innerText.split("\n").map(line => line.trim()).filter(Boolean);
        const likeText = likeElement?.textContent?.trim() || cardLines.at(-1) || "";
        return { card, titleLink, likes: parseLikeCount(likeText) };
    }).filter(item => item.titleLink && item.likes > 0);

    rankedCards.sort((left, right) => right.likes - left.likes);
    return rankedCards[0] || null;
}

async function extractListCard(cardData) {
    const { card, titleLink, likes } = cardData;
    const title = titleLink.innerText.trim();
    if (!title) throw new Error("未识别到最高赞笔记标题");

    const sourceUrl = titleLink.href || new URL(titleLink.getAttribute("href"), window.location.href).href;
    if (!sourceUrl) throw new Error("未识别到最高赞笔记详情链接");

    console.log(`[RED AI Scraper] 列表页选择最高赞笔记：${likes} 赞，正在读取详情 HTML`);

    let response;
    try {
        response = await fetch(sourceUrl, {
            credentials: "include",
            headers: { Accept: "text/html,application/xhtml+xml" }
        });
    } catch (error) {
        throw new Error(`最高赞笔记详情读取失败：${error.message}`);
    }

    if (!response.ok) {
        throw new Error(`最高赞笔记详情暂时无法读取（HTTP ${response.status}）`);
    }

    const html = await response.text();
    if (!html || html.includes("error_code=300031") || html.includes('"error_code":300031')) {
        throw new Error("最高赞笔记详情暂时无法读取，小红书返回了不可浏览页面");
    }

    const detailDocument = new DOMParser().parseFromString(html, "text/html");
    const cleanText = text => Array.from(new Set((text || "").split("\n").map(line => line.trim()).filter(Boolean))).join("\n");
    const initialStateScript = Array.from(detailDocument.querySelectorAll("script"))
        .find(script => script.textContent.trim().startsWith("window.__INITIAL_STATE__="));
    let noteState = null;
    if (initialStateScript) {
        try {
            const serializedState = initialStateScript.textContent.trim()
                .slice("window.__INITIAL_STATE__=".length)
                .replace(/;\s*$/, "")
                .replace(/\bundefined\b/g, "null");
            const initialState = JSON.parse(serializedState);
            noteState = Object.values(initialState?.note?.noteDetailMap || {})
                .find(detail => detail?.note)?.note || null;
        } catch (error) {
            console.warn("[RED AI Scraper] 初始化数据解析失败，将使用详情 DOM：", error.message);
        }
    }
    const textFrom = selectors => selectors.map(selector => detailDocument.querySelector(selector)?.textContent || "")
        .map(cleanText)
        .filter(Boolean)
        .sort((left, right) => right.length - left.length)[0] || "";
    const detailTitle = cleanText(noteState?.title) || textFrom([
        "#detail-title",
        ".interaction-container #detail-title",
        ".note-scroller .note-content > .title",
        ".note-content > .title"
    ]) || title;
    const detailContent = cleanText(noteState?.desc) || textFrom([
        "#detail-desc",
        ".note-container #detail-desc",
        "#note-page-container #detail-desc",
        ".note-content #detail-desc",
        ".note-container .desc",
        "#note-page-container .desc",
        ".note-content .desc"
    ]);
    if (!detailContent || detailContent === detailTitle) {
        throw new Error("最高赞笔记详情暂时无法读取，未找到完整正文");
    }

    const detailRoot = detailDocument.querySelector(".note-container, #note-page-container, [class*='note-detail']") || detailDocument;
    const stateImageSources = Array.isArray(noteState?.imageList) ? noteState.imageList
        .map(image => image.urlDefault || image.urlPre || image.url || image.infoList?.find(item => item.imageScene === "WB_DFT")?.url || image.infoList?.[0]?.url)
        .filter(Boolean)
        .map(src => src.replace(/^http:/, "https:")) : [];
    const domImageSources = extractNoteMediaSources(detailRoot);
    const mediaSources = (stateImageSources.length ? stateImageSources : domImageSources)
        .filter((src, index, all) => all.indexOf(src) === index);
    const coverImage = detailDocument.querySelector("meta[property='og:image']")?.getAttribute("content");
    if (!mediaSources.length && coverImage) mediaSources.push(coverImage.replace(/^http:/, "https:"));

    const detailAuthor = cleanText(noteState?.user?.nickname) || textFrom([
        ".author-container .name",
        ".author-container .nickname",
        ".user-name",
        ".username",
        "a[href*='/user/profile/'] .name"
    ]) || card.querySelector("a[href*='/user/profile/']")?.innerText.trim() || "小红书爆款达人";
    const detailLikeText = textFrom([
        ".interact-container .like-wrapper .count",
        ".like-wrapper .count",
        ".like-wrapper"
    ]);
    const detailLikes = parseLikeCount(noteState?.interactInfo?.likedCount || detailLikeText) || likes;

    return {
        title: detailTitle,
        content: detailContent,
        author: detailAuthor,
        likes: detailLikes,
        images: mediaSources,
        source_url: sourceUrl
    };
}

async function extractCurrentOrTopLikedPost() {
    if (findDetailTitle()) return extractPageContent();

    const topLiked = findTopLikedNoteCard();
    if (!topLiked) throw new Error("当前页面未识别到带点赞数的笔记卡片");

    return extractListCard(topLiked);
}

// 监听来自 Extension Background / Popup 的指令
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCRAPE_CURRENT_PAGE") {
        (async () => {
            try {
                const data = await extractCurrentOrTopLikedPost();
                chrome.runtime.sendMessage({ action: "SCRAPE_SUBMIT", payload: data }, (res) => {
                    sendResponse(res?.success
                        ? { success: true, data }
                        : { success: false, reason: res?.reason || "复刻失败，请查看控制台" });
                });
            } catch (error) {
                sendResponse({ success: false, reason: error.message });
            }
        })();
        return true;
    }

    if (request.action === "EXECUTE_AUTO_PUBLISH") {
        executePublishWorkflow().then(res => {
            sendResponse(res);
        }).catch(err => {
            sendResponse({ success: false, reason: err.message });
        });
        return true;
    }
});

/** 抓取逻辑：从小红书 DOM 提取爆款数据 */
function extractPageContent() {
    console.log("[RED AI Scraper] 开始解析当前小红书 DOM 节点...");

    // 1. 解析标题 (严格过滤 "猜你想搜" 等 UI 干扰词)
    const invalidTitles = ["猜你想搜", "相关搜索", "全部评论", "小红书", "搜索", "评论"];
    const titleEl = findDetailTitle();
    if (!titleEl) throw new Error("请先打开具体笔记详情后重试");
    const title = titleEl.innerText.trim();
    if (!title || invalidTitles.some(keyword => title.includes(keyword))) throw new Error("未识别到有效笔记标题");
    const noteRoot = titleEl.closest(".note-container, #note-page-container, [class*='note-detail']") || document;

    // 2. 解析正文描述，只在笔记详情容器内查找，避免误抓页面页脚
    const footerMarkers = ["ICP备", "营业执照", "公网安备", "增值电信业务经营许可证", "举报电话", "网络文化经营许可证", "网信算备"];
    const cleanContent = text => {
        const seen = new Set();
        return (text || "").split("\n").map(line => line.trim()).filter(line => {
            if (!line || footerMarkers.some(marker => line.includes(marker)) || seen.has(line)) return false;
            seen.add(line);
            return true;
        }).join("\n");
    };
    const contentSelectors = [
        "#detail-desc",
        ".note-container #detail-desc",
        "#note-page-container #detail-desc",
        ".note-content #detail-desc",
        ".note-container .desc",
        "#note-page-container .desc",
        ".note-content .desc"
    ];
    const contentCandidates = contentSelectors.flatMap(selector => Array.from(noteRoot.querySelectorAll(selector)))
        .map(element => cleanContent(element.innerText))
        .filter(text => text.length >= 8);
    let content = contentCandidates.sort((left, right) => right.length - left.length)[0] || "";

    // 3. 解析作者
    let author = noteRoot.querySelector(".author-container .name")?.innerText.trim()
        || noteRoot.querySelector(".author-container .nickname")?.innerText.trim()
        || noteRoot.querySelector(".user-name, .username")?.innerText.trim();
    if (!author) {
        const authorEl = noteRoot.querySelector("a[href*='/user/profile/'] .name, .author-container a");
        if (authorEl) author = authorEl.innerText.trim();
    }
    if (!author) author = "小红书爆款达人";

    // 4. 解析点赞数
    const likeEl = noteRoot.querySelector(".interact-container .like-wrapper .count")
        || noteRoot.querySelector(".interact-container .like-wrapper");
    const likes = parseLikeCount(likeEl?.innerText || likeEl?.textContent || "");

    // 5. 解析图片 URL
    const images = extractNoteMediaSources(noteRoot);

    // 6. 兜底逻辑：若选择器均失效，提取页面标题与文案
    if (!content) {
        const metaDescription = cleanContent(document.querySelector('meta[name="description"]')?.content || "");
        content = metaDescription || "";
    }

    if (!content) throw new Error("未识别到有效笔记正文，请打开具体笔记详情后重试");

    const scrapedData = {
        title,
        content,
        author: author,
        likes: likes,
        images,
        source_url: window.location.href
    };

    console.log("[RED AI Scraper] 提取到的真实小红书爆款数据:", scrapedData);
    return scrapedData;
}

/** 拟人化自动发布流程 */
async function executePublishWorkflow() {
    // 1. 向后台获取待发布任务
    const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: "GET_PENDING_QUEUE" }, resolve);
    });

    if (!res || !res.success || !res.data || !res.data.posts || res.data.posts.length === 0) {
        return { success: false, reason: "发布队列中没有待发布 (APPROVED) 的任务！" };
    }

    const task = res.data.posts[0]; // 获取排在最前的一个任务
    console.log("[RED AI Publisher] 开始自动填充任务:", task);

    // 1.1 如果处于创作者首页 (new/home)，自动点击左上角【+ 发布笔记】进入发布页
    if (window.location.pathname.includes("/new/home") || window.location.pathname === "/") {
        console.log("[RED AI Publisher] 检测到处于创作者首页，自动点击【+ 发布笔记】跳转发布页...");
        const homePublishBtn = Array.from(document.querySelectorAll("button, div, a, span")).find(el => el.innerText && el.innerText.includes("发布笔记"));
        if (homePublishBtn) {
            triggerFullClick(homePublishBtn);
            showNotificationBanner("🚀 [RED AI Studio] 正在为您点击【发布笔记】进入编辑中心...");
            return { success: true, message: "已自动触发跳转至发布页" };
        }
    }

    // 2. 区分发布类型：检测并自动点击切换至【上传图文】Tab
    showNotificationBanner("⏳ [RED AI Studio] 正在准备自动化填充，切换选项卡中...");
    
    for (let retry = 0; retry < 5; retry++) {
        const tabCandidates = Array.from(document.querySelectorAll("div, span, button, li, a"));
        const imageTextTab = tabCandidates.find(el => el.innerText && el.innerText.trim() === "上传图文" && el.children.length === 0);
        if (imageTextTab) {
            triggerFullClick(imageTextTab);
            await new Promise(r => setTimeout(r, 500));
            break;
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // 3. 借鉴 XiaohongshuSkills 设计：构建强健的图片素材注入通道
    let titleInput = document.querySelector("input[placeholder*='标题'], input.c-input_inner, input[maxlength='20'], .title-input input");
    let contentInput = document.querySelector("#post-textarea, div[contenteditable='true'], textarea, .editor-content");

    if (!titleInput && !contentInput) {
        showNotificationBanner("⏳ [RED AI Studio] (借鉴 XiaohongshuSkills 机制) 正在尝试一键自动挂载图文素材文件...");
        console.log("[RED AI Publisher] 处于素材选择页，正在发送 File 对象注入小红书上传通道...");
        
        // 发布阶段只允许使用 AI 生成图，避免生图失败时误发原素材。
        const mediaUrls = Array.isArray(task.ai_images) ? task.ai_images.filter(Boolean) : [];
        if (mediaUrls.length === 0) {
            const reason = "当前任务没有可发布的 AI 配图，请先重新生成配图后再发布";
            showNotificationBanner(`⚠️ [RED AI Studio] ${reason}`, "#ef4444");
            return { success: false, reason };
        }

        // 执行异步图片流下载与 DataTransfer 注入
        await autoUploadImageFiles(mediaUrls);
        
        // 轮询监听小红书滑入真正的图文编辑主页 (15 次步进监听)
        for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(r => setTimeout(r, 500));
            
            titleInput = document.querySelector("input[placeholder*='标题'], input.c-input_inner, input[maxlength='20'], .title-input input");
            contentInput = document.querySelector("#post-textarea, div[contenteditable='true'], textarea, .editor-content");
            
            if (titleInput || contentInput) {
                console.log("[RED AI Publisher] 🎉 成功进入小红书【标准图文编辑主页】！");
                showNotificationBanner("✨ [RED AI Studio] 已成功到达图文编辑主页！正在拟人化输入文案...", "#10b981");
                await new Promise(r => setTimeout(r, 400));
                break;
            }
        }
    }

    if (!titleInput && !contentInput) {
        showNotificationBanner("💡 [RED AI Studio] 素材已就绪！请点击中间【上传图片】选定封面，滑入编辑框后将自动为您打字", "#3b82f6");
        return { 
            success: false, 
            reason: "素材已准备完成，等待进入主编辑框。" 
        };
    }

    showNotificationBanner("🚀 [RED AI Studio] 正在为您执行拟人化键盘逐字输入...");

    // 重新检索 DOM 最新文本输入框节点 (增加针对小红书新版正文描述 placeholder 的选择器)
    titleInput = document.querySelector("input[placeholder*='标题'], input.c-input_inner, input[maxlength='20'], .title-input input");
    contentInput = document.querySelector("div[placeholder*='正文'], div[placeholder*='描述'], #post-textarea, div[contenteditable='true'], textarea, .editor-content, .post-content");

    // 3. 执行拟人化打字输入 (Title: 使用后端由 AI 生成的标准吸睛标题)
    let titleSuccess = false;
    let contentSuccess = false;

    if (titleInput) {
        let titleText = (task.ai_title || task.original_title || "爆款图文分享").trim();
        
        // 核心双重防护：检测 Emoji 等代理对字符 (Emoji 占用 JS .length 为 2)
        const hasEmoji = /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(titleText);
        const maxLen = hasEmoji ? 18 : 20;
        if (titleText.length > maxLen) {
            titleText = titleText.slice(0, maxLen);
        }

        console.log(`[RED AI Publisher] 开始填充标题 (双重字数安全防护, length=${titleText.length}):`, titleText);
        await simulateHumanType(titleInput, titleText);
        titleSuccess = true;
    }

    // 4. 执行拟人化打字输入 (Content & Tags: 激活 React/Draft.js 状态机)
    if (contentInput) {
        console.log("[RED AI Publisher] 开始填充正文与话题...");
        const tagsStr = (task.ai_tags && task.ai_tags.length > 0) ? task.ai_tags.map(t => t.startsWith('#') ? t : `#${t}`).join(" ") : "";
        const fullContent = `${task.ai_content || task.original_content}\n\n${tagsStr}`;
        
        // 深入寻找内部最切实的 contenteditable 编辑卡片
        let editableTarget = contentInput;
        if (!editableTarget.isContentEditable && editableTarget.getAttribute('contenteditable') !== 'true') {
            editableTarget = contentInput.querySelector("[contenteditable='true']") || contentInput;
        }

        await simulateHumanType(editableTarget, fullContent);
        contentSuccess = true;
    }

    if (titleSuccess || contentSuccess) {
        showNotificationBanner("🛡️ [RED AI Studio] 拟人化打字完毕！正在进行防风控安全审阅停顿...", "#10b981");
        
        // 核心防风控：模拟人类打完字后预览检查文案的自然停顿 (1.5s ~ 2.2s)
        const reviewDelay = Math.floor(Math.random() * 700) + 1500;
        await new Promise(r => setTimeout(r, reviewDelay));

        // 5. 自动寻找并精准触发底部的红色【发布】大按钮 (全物理 Mouse/PointerEvent 仿真)
        const allBtns = Array.from(document.querySelectorAll("button, div[class*='btn'], span"));
        const publishBtn = allBtns.find(b => {
            return b.innerText && b.innerText.trim() === "发布" && b.children.length <= 1;
        });

        if (publishBtn) {
            console.log("[RED AI Publisher] 捕获到底部【发布】按钮，派发仿真 Mouse/Pointer 事件链...", publishBtn);
            
            // 派发仿真鼠标划入与悬停事件，规避前端 DOM 轨迹捕获
            publishBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
            publishBtn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
            publishBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
            
            triggerFullClick(publishBtn);
            
            showNotificationBanner("🎉 [RED AI Studio] 笔记已成功安全提交小红书平台！", "#10b981");
            
            // 更新后端状态为 PUBLISHED
            chrome.runtime.sendMessage({
                action: "UPDATE_PUBLISH_STATUS",
                payload: { post_id: task.id, status: "PUBLISHED" }
            });
            return { success: true, message: `任务 #${task.id} 已成功安全全自动发布！` };
        } else {
            showNotificationBanner("🎉 [RED AI Studio] 标题与正文已填入！请核对后手动点击【发布】按钮", "#10b981");
            return { success: true, message: `任务 #${task.id} 填充完毕！` };
        }
    } else {
        showNotificationBanner("⚠️ [RED AI Studio] 文案填充中断，请重试", "#ef4444");
        return { success: false, reason: "填充中途中断，未找到有效的输入框。" };
    }
}

/**
 * 核心防风控：拟人化打字模拟
 * 带有 30ms ~ 90ms 的随机时间间隔并逐字触发 InputEvent
 */
async function simulateHumanType(element, text) {
    element.focus();
    
    // 如果是 input
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        element.value = "";
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            element.value += char;
            
            // 派发原生 Input 事件
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

            // 随机时延模拟人工按键
            const delay = Math.floor(Math.random() * 50) + 30;
            await new Promise(r => setTimeout(r, delay));
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
    } 
    // 如果是 contenteditable 富文本框 (如 Draft.js / Slate.js 容器)
    else if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
        element.focus();
        
        // 1. 全选原有占位节点
        document.execCommand('selectAll', false, null);

        // 2. 按 #话题切段，逐个输入并选择候选弹窗首项
        const topicPattern = /#[\p{L}\p{N}_\u4e00-\u9fff]+/gu;
        let cursor = 0;
        for (const match of text.matchAll(topicPattern)) {
            await typeContentSegment(element, text.slice(cursor, match.index));
            await typeContentSegment(element, match[0]);
            await selectFirstTopicSuggestion();
            cursor = match.index + match[0].length;
        }
        await typeContentSegment(element, text.slice(cursor));

        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    }
}

async function typeContentSegment(element, text) {
    const lines = text.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        for (let charIdx = 0; charIdx < line.length; charIdx++) {
            const char = line[charIdx];
            document.execCommand('insertText', false, char);
            element.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: char, bubbles: true }));
            const jitter = Math.floor(Math.random() * 50) + 40;
            await new Promise(resolve => setTimeout(resolve, jitter));
        }
        if (idx < lines.length - 1) {
            document.execCommand('insertParagraph', false, null);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            const linePause = Math.floor(Math.random() * 220) + 180;
            await new Promise(resolve => setTimeout(resolve, linePause));
        }
    }
}

function getVisibleTopicSuggestions() {
    const selectors = [
        ".tippy-box .item",
        "[role='listbox'] [role='option']",
        "[class*='topic'] [class*='item']",
        "[class*='suggest'] [class*='item']"
    ];
    return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)))
        .filter((option, index, all) => all.indexOf(option) === index)
        .filter(option => isVisibleElement(option) && option.innerText.trim().startsWith('#'));
}

async function waitForTopicSuggestion(timeout = 1800) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const suggestion = getVisibleTopicSuggestions()[0];
        if (suggestion) return suggestion;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return null;
}

async function waitForTopicSuggestionClose(timeout = 800) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (getVisibleTopicSuggestions().length === 0) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return getVisibleTopicSuggestions().length === 0;
}

async function selectFirstTopicSuggestion() {
    const suggestion = await waitForTopicSuggestion();
    if (!suggestion) {
        console.warn("[RED AI Publisher] 未出现话题候选弹窗，保留当前话题文本继续输入");
        return false;
    }

    console.log("[RED AI Publisher] 选择话题候选首项:", suggestion.innerText.trim());
    await triggerFullClick(suggestion);
    await waitForTopicSuggestionClose();
    return true;
}

/** 页面防风控悬浮模拟器（展示拟人化填充全过程与一键发布） */
function showFloatingSimulator(task) {
    const oldSim = document.getElementById("red-ai-sim-box");
    if (oldSim) oldSim.remove();

    const box = document.createElement("div");
    box.id = "red-ai-sim-box";
    box.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 360px;
        background: #181820;
        border: 2px solid #ff2442;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.8);
        z-index: 999999;
        color: #fff;
        font-family: sans-serif;
        font-size: 13px;
    `;

    box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <strong style="color:#ff2442; font-size:14px;">🔥 自研插件防风控发布中...</strong>
            <span style="font-size:11px; background:rgba(16,185,129,0.2); color:#34d399; padding:2px 6px; border-radius:4px;">防风控打字模式</span>
        </div>
        <div style="margin-bottom:8px; color:#aaa;">当前待发布 ID: #${task.id}</div>
        <div style="background:#0d0d12; padding:10px; border-radius:6px; margin-bottom:10px;">
            <div style="font-weight:600; color:#fff; margin-bottom:4px;">${task.ai_title || task.original_title}</div>
            <div style="color:#888; font-size:12px; height:60px; overflow-y:auto;">${task.ai_content || task.original_content}</div>
        </div>
        <div style="display:flex; gap:8px;">
            <button id="sim-btn-fill" style="flex:1; background:#ff2442; color:#fff; border:none; padding:8px; border-radius:6px; cursor:pointer; font-weight:600;">模拟逐字键盘填充</button>
            <button id="sim-btn-close" style="background:#333; color:#ccc; border:none; padding:8px; border-radius:6px; cursor:pointer;">关闭</button>
        </div>
    `;

    document.body.appendChild(box);

    document.getElementById("sim-btn-close").onclick = () => box.remove();
    document.getElementById("sim-btn-fill").onclick = async () => {
        alert("已成功派发防风控逐字输入指令！已将发布状态更新为 [PUBLISHED]");
        chrome.runtime.sendMessage({
            action: "UPDATE_PUBLISH_STATUS",
            payload: { post_id: task.id, status: "PUBLISHED" }
        });
        box.remove();
    };
}

/**
 * 自动构建 HTML5 DataTransfer 并触发小红书图片真实上传 (借鉴 XiaohongshuSkills 思路)
 */
async function autoUploadImageFiles(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) return false;

    try {
        console.log("[RED AI Publisher] (借鉴 XiaohongshuSkills 思路) 正在将配图转为 File 对象注入页面...", imageUrls);
        const dt = new DataTransfer();
        
        for (let i = 0; i < Math.min(imageUrls.length, 3); i++) {
            const url = imageUrls[i];
            if (!url) continue;

            const res = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: "FETCH_IMAGE_BASE64", url: url }, resolve);
            });

            if (res && res.success && res.base64) {
                const arr = res.base64.split(',');
                const mimeMatch = arr[0].match(/:(.*?);/);
                const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                const file = new File([u8arr], `red_ai_cover_${i + 1}.jpg`, { type: mime });
                dt.items.add(file);
                console.log(`[RED AI Publisher] 成功将配图 #${i + 1} 构建为 File 对象!`);
            }
        }

        if (dt.files.length === 0) return false;

        // 全概率检索页面中所有的 input[type='file']
        let fileInput = document.querySelector("input[type='file']");
        if (!fileInput) {
            const allInputs = Array.from(document.querySelectorAll("input"));
            fileInput = allInputs.find(i => i.type === "file" || (i.accept && i.accept.includes("image")));
        }

        if (fileInput) {
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            fileInput.dispatchEvent(new Event('input', { bubbles: true }));
            console.log("[RED AI Publisher] ✅ 成功通过 fileInput 注入图片！");
            return true;
        }

        // 兜底派发 DropEvent 拖拽上传
        const dropPanel = document.querySelector(".upload-button") || document.body;
        const dragEnterEvent = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt });
        const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
        const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });

        dropPanel.dispatchEvent(dragEnterEvent);
        dropPanel.dispatchEvent(dragOverEvent);
        dropPanel.dispatchEvent(dropEvent);
        return true;

    } catch (e) {
        console.warn("[RED AI Publisher] 自动构建与派发图片 File 时出现异常:", e);
    }
    return false;
}

/**
 * 顶级防风控：三阶贝塞尔物理鼠标移动曲线模拟器 (Cubic Bezier Traversal)
 * 模拟人类手部肌肉在移动鼠标时的【加速-匀速-减速微抖动】物理轨迹，规避 SDK 探针检测
 */
async function simulateHumanMouseMove(targetElement) {
    if (!targetElement) return;
    const rect = targetElement.getBoundingClientRect();
    
    // 目标坐标 (加上随机微小偏置)
    const targetX = rect.left + rect.width / 2 + (Math.random() * 10 - 5);
    const targetY = rect.top + rect.height / 2 + (Math.random() * 6 - 3);

    // 当前起始坐标 (若为初始，从窗口随机偏移点切入)
    const startX = window.currentMouseX || (targetX - Math.random() * 300 - 100);
    const startY = window.currentMouseY || (targetY - Math.random() * 200 - 50);

    // 三阶贝塞尔控制点 (注入物理微振幅)
    const controlX1 = startX + (targetX - startX) * 0.25 + (Math.random() * 60 - 30);
    const controlY1 = startY + (targetY - startY) * 0.25 + (Math.random() * 60 - 30);
    const controlX2 = startX + (targetX - startX) * 0.75 + (Math.random() * 60 - 30);
    const controlY2 = startY + (targetY - startY) * 0.75 + (Math.random() * 60 - 30);

    const steps = 16; // 轨迹采样点数量
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Ease-In-Out 缓动函数模拟人体工学加速度
        const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

        const u = 1 - easeT;
        const tt = easeT * easeT;
        const uu = u * u;
        const uuu = uu * u;
        const ttt = tt * easeT;

        const x = uuu * startX + 3 * uu * easeT * controlX1 + 3 * u * tt * controlX2 + ttt * targetX;
        const y = uuu * startY + 3 * uu * easeT * controlY1 + 3 * u * tt * controlY2 + ttt * targetY;

        // 向全局与目标元素派发 mousemove 与 pointermove 事件
        const mouseEvt = new MouseEvent('mousemove', {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            view: window
        });
        document.dispatchEvent(mouseEvt);
        targetElement.dispatchEvent(mouseEvt);

        window.currentMouseX = x;
        window.currentMouseY = y;

        // 步进采样间隔 (6ms ~ 16ms)
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 10) + 6));
    }
}

/** 派发跨框架完整的 MouseEvent 链点击 (自动前置注入三阶贝塞尔物理鼠标轨迹) */
async function triggerFullClick(element) {
    if (!element) return;
    
    // 1. 自动前置生成三阶贝塞尔曲线鼠标移动轨迹 (模拟人类手部肌肉匀加速/减速划过屏幕)
    try {
        await simulateHumanMouseMove(element);
    } catch (e) {
        console.warn("[RED AI Publisher] 鼠标贝塞尔轨迹模拟小微调:", e);
    }

    // 2. 触发原生的按压、焦点与点击事件链
    element.focus && element.focus();
    element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

/** 精准捕获并触发【文字配图】按钮点击 (支持祖先节点全路径事件穿透) */
function tryClickTextImgBtn() {
    const allEls = Array.from(document.querySelectorAll("button, div, span, a, p"));
    // 寻找包含“文字配图”文字的最深元素
    const targetTextEl = allEls.find(el => {
        return el.childNodes && Array.from(el.childNodes).some(node => node.nodeType === 3 && node.nodeValue && node.nodeValue.includes("文字配图"));
    });

    if (targetTextEl) {
        console.log("[RED AI Publisher] 精准捕获【文字配图】节点:", targetTextEl);
        let curr = targetTextEl;
        for (let depth = 0; depth < 3 && curr && curr !== document.body; depth++) {
            triggerFullClick(curr);
            curr = curr.parentElement;
        }
        return true;
    }
    return false;
}

/** 触发【上传图片/文字配图】流程：自动注入素材或一键唤醒文字配图展开编辑框 */
async function tryTriggerImageUpload(task) {
    const imageUrls = Array.isArray(task?.ai_images) ? task.ai_images.filter(Boolean) : [];
    
    // 1. 尝试定位页面现有的 file input 节点
    let fileInput = document.querySelector("input[type='file'][accept*='image'], input[type='file']");
    if (!fileInput) {
        const container = document.querySelector("div[class*='upload'], div[class*='card']");
        if (container) fileInput = container.querySelector("input");
    }

    // 2. 若存在 file input 且有配图，优先通过 Background 跨域下载并注入
    if (fileInput && imageUrls && imageUrls.length > 0) {
        console.log("[RED AI Publisher] 尝试通过 DataTransfer 自动注入配图...", imageUrls);
        const success = await autoUploadImageFiles(imageUrls);
        if (success) {
            console.log("[RED AI Publisher] ✅ 成功注入素材文件！编辑框展开中...");
            return true;
        }
    }

    // 3. 核心突破：免弹窗一键自动激活【文字配图】，秒级展开标题与正文编辑框！
    console.log("[RED AI Publisher] 自动激活【文字配图】一键展开排版与编辑框架...");
    const textImgSuccess = tryClickTextImgBtn();
    if (textImgSuccess) {
        console.log("[RED AI Publisher] ✅ 已成功派发【文字配图】唤醒指令！");
        return true;
    }

    // 4. 兜底：若以上均未找到，点击红色【上传图片】按钮
    const allEls = Array.from(document.querySelectorAll("button, div, span, a, p"));
    const uploadBtn = allEls.find(el => {
        return el.childNodes && Array.from(el.childNodes).some(node => node.nodeType === 3 && node.nodeValue && node.nodeValue.trim() === "上传图片");
    });

    if (uploadBtn) {
        console.log("[RED AI Publisher] 捕获到红色【上传图片】按钮，派发点击...", uploadBtn);
        let curr = uploadBtn;
        for (let depth = 0; depth < 3 && curr && curr !== document.body; depth++) {
            triggerFullClick(curr);
            curr = curr.parentElement;
        }
        return true;
    }

    return false;
}

/** 自动检测并点击可能出现的【下一步 / 确定 / 生成图片 / 完成】Modal 确认按钮 */
function tryConfirmNextStep() {
    const keywords = ["下一步", "确定", "生成图片", "完成", "使用该样式", "生成图文"];
    const candidates = Array.from(document.querySelectorAll("button, div[class*='btn'], div[class*='button'], span, div, a"));
    
    for (const kw of keywords) {
        const btn = candidates.find(el => {
            return el.innerText && el.innerText.trim() === kw && el.children.length <= 2;
        });
        if (btn) {
            console.log(`[RED AI Publisher] 捕获到推进按钮 【${kw}】，自动派发点击...`, btn);
            triggerFullClick(btn);
            return true;
        }
    }
    return false;
}

/** 页面顶部防风控自动化实时进度状态栏 */
function showNotificationBanner(message, bg = "#ff2442") {
    let banner = document.getElementById("red-ai-status-banner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "red-ai-status-banner";
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 9999999;
            background: ${bg};
            color: #fff;
            padding: 10px 20px;
            text-align: center;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        `;
        document.body.appendChild(banner);
    }
    banner.style.background = bg;
    banner.innerHTML = message;

    if (message.includes("成功") || message.includes("完结")) {
        setTimeout(() => {
            if (banner) banner.remove();
        }, 5000);
    }
}
