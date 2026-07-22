const BACKEND_URL = "http://localhost:8888/api";

chrome.runtime.onInstalled.addListener(() => {
    console.log("[RED AI Publisher Extension] 插件成功安装");
});

// 监听 Popup 或 Content Script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
        fetch(`${BACKEND_URL}/posts/scrape`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.payload)
        })
            .then(res => res.json())
            .then(data => {
                // 自动触发火山 AI 复刻
                return fetch(`${BACKEND_URL}/posts/${data.post_id}/replicate`, { method: "POST" });
            })
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true;
    }
});
