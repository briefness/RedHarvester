const test = require('node:test');
const assert = require('node:assert/strict');

const { createDetailTabScraper } = require('./detail_tab');

function createChromeMock({ initialStatus = 'complete', response = { success: true, data: { title: 'detail' } } } = {}) {
    const listeners = new Set();
    const calls = [];
    const chromeApi = {
        tabs: {
            create: async options => {
                calls.push(['create', options]);
                return { id: 42, status: initialStatus };
            },
            get: async id => ({ id, status: initialStatus }),
            sendMessage: async (id, message) => {
                calls.push(['sendMessage', id, message]);
                if (response instanceof Error) throw response;
                return response;
            },
            remove: async id => calls.push(['remove', id]),
            onUpdated: {
                addListener: listener => listeners.add(listener),
                removeListener: listener => listeners.delete(listener)
            }
        }
    };

    return { calls, chromeApi, listeners };
}

test('loads detail in an inactive tab and closes it after scraping', async () => {
    const { calls, chromeApi } = createChromeMock();
    const scrapeDetailTab = createDetailTabScraper(chromeApi);

    const data = await scrapeDetailTab('https://www.xiaohongshu.com/explore/note-id', { likes: 12000 });

    assert.deepEqual(data, { title: 'detail' });
    assert.deepEqual(calls[0], ['create', {
        active: false,
        url: 'https://www.xiaohongshu.com/explore/note-id'
    }]);
    assert.equal(calls[1][0], 'sendMessage');
    assert.deepEqual(calls.at(-1), ['remove', 42]);
});

test('preserves the search result token when opening a note detail', async () => {
    const { calls, chromeApi } = createChromeMock();
    const scrapeDetailTab = createDetailTabScraper(chromeApi);
    const sourceUrl = 'https://www.xiaohongshu.com/search_result/note-id?xsec_token=token&xsec_source=pc_search';

    await scrapeDetailTab(sourceUrl, {});

    assert.deepEqual(calls[0], ['create', { active: false, url: sourceUrl }]);
});

test('waits for the detail tab to finish loading before scraping', async () => {
    const { calls, chromeApi, listeners } = createChromeMock({ initialStatus: 'loading' });
    const scrapeDetailTab = createDetailTabScraper(chromeApi, 1000);
    const pending = scrapeDetailTab('https://www.xiaohongshu.com/explore/note-id', {});

    await Promise.resolve();
    assert.equal(calls.some(call => call[0] === 'sendMessage'), false);
    listeners.forEach(listener => listener(42, { status: 'complete' }));
    await pending;

    assert.equal(calls.some(call => call[0] === 'sendMessage'), true);
    assert.equal(listeners.size, 0);
});

test('closes the background tab when detail extraction fails', async () => {
    const { calls, chromeApi } = createChromeMock({ response: new Error('content script unavailable') });
    const scrapeDetailTab = createDetailTabScraper(chromeApi);

    await assert.rejects(
        scrapeDetailTab('https://www.xiaohongshu.com/explore/note-id', {}),
        /content script unavailable/
    );
    assert.deepEqual(calls.at(-1), ['remove', 42]);
});

test('rejects non-Xiaohongshu detail URLs before opening a tab', async () => {
    const { calls, chromeApi } = createChromeMock();
    const scrapeDetailTab = createDetailTabScraper(chromeApi);

    await assert.rejects(
        scrapeDetailTab('https://example.com/explore/note-id', {}),
        /只允许读取小红书笔记详情链接/
    );
    assert.deepEqual(calls, []);
});
