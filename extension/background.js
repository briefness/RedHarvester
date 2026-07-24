importScripts('detail_tab.js');

const BACKEND_URL = "http://localhost:8888/api";
const scrapeDetailTab = DetailTabScraper.createDetailTabScraper(chrome);

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `后端请求失败 (${response.status})`);
    return data;
}

chrome.runtime.onInstalled.addListener(() => {
    console.log("[RED AI Publisher Extension] 插件成功安装");
});

// 监听 Popup 或 Content Script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCRAPE_DETAIL_IN_BACKGROUND") {
        scrapeDetailTab(request.url, request.fallback || {})
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, reason: error.message }));
        return true;
    }

    if (request.action === "GET_PENDING_QUEUE") {
        fetch(`${BACKEND_URL}/extension/pending-publish`)
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true; // 异步响应
    }

    if (request.action === "UPDATE_PUBLISH_STATUS") {
        fetch(`${BACKEND_URL}/extension/update-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.payload)
        })
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true;
    }

    if (request.action === "FETCH_IMAGE_BASE64") {
        fetch(request.url)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    sendResponse({ success: true, base64: reader.result, type: blob.type });
                };
                reader.readAsDataURL(blob);
            })
            .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true;
    }

    if (request.action === "SCRAPE_SUBMIT") {
        fetchJson(`${BACKEND_URL}/posts/scrape`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.payload)
        })
            .then(data => {
                return fetchJson(`${BACKEND_URL}/posts/${data.post_id}/replicate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({})
                });
            })
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, reason: err.message }));
        return true;
    }
});
