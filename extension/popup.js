document.addEventListener('DOMContentLoaded', () => {
    const connStatus = document.getElementById('conn-status');
    const queueCount = document.getElementById('queue-count');
    const msgBox = document.getElementById('msg-box');
    const btnScrape = document.getElementById('btn-scrape-page');
    const btnPublish = document.getElementById('btn-auto-publish');

    // 检查后端状态与待发布数量
    function checkBackend() {
        chrome.runtime.sendMessage({ action: "GET_PENDING_QUEUE" }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                connStatus.textContent = "后端未连接";
                connStatus.style.background = "rgba(239,68,68,0.2)";
                connStatus.style.color = "#f87171";
                queueCount.textContent = "0 条";
            } else {
                connStatus.textContent = "在线就绪";
                connStatus.style.background = "rgba(16, 185, 129, 0.2)";
                connStatus.style.color = "#34d399";
                const count = response.data.count || 0;
                queueCount.textContent = `${count} 条`;
            }
        });
    }

    // 抓取当前页面爆款
    btnScrape.addEventListener('click', async () => {
        msgBox.textContent = "⏳ 正在识别页面爆款数据...";
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab || !tab.url || !tab.url.includes("xiaohongshu.com")) {
            msgBox.textContent = "⚠️ 请先打开小红书主站 (xiaohongshu.com/explore) 页面";
            return;
        }

        if (tab.url.includes("creator.xiaohongshu.com")) {
            msgBox.textContent = "ℹ️ 抓取爆款功能请打开小红书主站笔记页面使用！";
            return;
        }

        // 发送抓取消息并提供动态注入兜底
        function doSendScrapeMsg() {
            chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_CURRENT_PAGE" }, (res) => {
                if (chrome.runtime.lastError || !res) {
                    // 如果消息发送失败，尝试动态注入 content_script
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ["content_script.js"]
                    }, () => {
                        if (chrome.runtime.lastError) {
                            msgBox.textContent = "⚠️ 请刷新小红书笔记页面后重试";
                        } else {
                            setTimeout(doSendScrapeMsg, 300);
                        }
                    });
                    return;
                }
                if (res.success) {
                    msgBox.textContent = "✨ 爆款已成功抓取并提交 AI 复刻！请在控制台审核";
                    setTimeout(checkBackend, 1500);
                } else {
                    msgBox.textContent = `❌ 抓取失败: ${res.reason || '未发现图文'}`;
                }
            });
        }

        doSendScrapeMsg();
    });

    // 触发一键自动导航并发布
    btnPublish.addEventListener('click', async () => {
        msgBox.textContent = "⏳ 正在检查待发布任务并一键导航...";
        
        // 1. 检查后端是否有待发布任务
        chrome.runtime.sendMessage({ action: "GET_PENDING_QUEUE" }, async (response) => {
            if (!response || !response.success || !response.data || !response.data.posts || response.data.posts.length === 0) {
                msgBox.textContent = "⚠️ 发布队列中没有待发布 (APPROVED) 的任务！请先在控制台点击【审核通过】。";
                return;
            }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const targetPublishUrl = "https://creator.xiaohongshu.com/publish/publish";

            // 如果已经在发布页，直接触发填充
            if (tab && tab.url.includes("creator.xiaohongshu.com") && tab.url.includes("publish")) {
                msgBox.textContent = "🚀 正在派发拟人化输入指令...";
                chrome.tabs.sendMessage(tab.id, { action: "EXECUTE_AUTO_PUBLISH" }, (res) => {
                    if (res && res.success) {
                        msgBox.textContent = "🎉 自动填充成功！请查看创作者平台页面。";
                    } else {
                        msgBox.textContent = `❌ ${res ? res.reason : '未找到编辑输入框'}`;
                    }
                });
            } else {
                // 如果不在发布页，设置标志位并自动导航跳转！
                msgBox.textContent = "🚀 正在自动导航跳转至小红书发布页面...";
                chrome.storage.local.set({ pendingAutoPublish: true }, () => {
                    chrome.tabs.update(tab.id, { url: targetPublishUrl });
                });
            }
        });
    });

    checkBackend();
});
