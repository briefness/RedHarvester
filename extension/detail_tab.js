(function exposeDetailTabScraper(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.DetailTabScraper = api;
})(typeof globalThis === 'undefined' ? null : globalThis, () => {
    function assertAllowedDetailUrl(sourceUrl) {
        const url = new URL(sourceUrl);
        const isXiaohongshu = url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com');
        const isDetailPath = /^\/(?:explore|search_result)\/[^/]+\/?$/.test(url.pathname);
        if (url.protocol !== 'https:' || !isXiaohongshu || !isDetailPath) {
            throw new Error('只允许读取小红书笔记详情链接');
        }
        return url.href;
    }

    function waitForTabComplete(chromeApi, tabId, timeoutMs) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                chromeApi.tabs.onUpdated.removeListener(handleUpdated);
                error ? reject(error) : resolve();
            };
            const handleUpdated = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
            };
            const timeoutId = setTimeout(
                () => finish(new Error('小红书详情页加载超时')),
                timeoutMs
            );

            chromeApi.tabs.onUpdated.addListener(handleUpdated);
            chromeApi.tabs.get(tabId)
                .then(tab => {
                    if (tab.status === 'complete') finish();
                })
                .catch(finish);
        });
    }

    function createDetailTabScraper(chromeApi, timeoutMs = 15000) {
        return async function scrapeDetailTab(sourceUrl, fallback) {
            const url = assertAllowedDetailUrl(sourceUrl);
            const detailTab = await chromeApi.tabs.create({ active: false, url });
            if (!Number.isInteger(detailTab.id)) throw new Error('无法创建小红书详情读取标签页');

            try {
                await waitForTabComplete(chromeApi, detailTab.id, timeoutMs);
                const response = await chromeApi.tabs.sendMessage(detailTab.id, {
                    action: 'SCRAPE_DETAIL_PAGE',
                    fallback
                });
                if (!response?.success || !response.data) {
                    throw new Error(response?.reason || '小红书详情页未返回完整数据');
                }
                return response.data;
            } finally {
                await chromeApi.tabs.remove(detailTab.id).catch(() => {});
            }
        };
    }

    return { createDetailTabScraper };
});
