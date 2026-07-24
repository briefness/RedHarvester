(function exposePostDiff(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PostDiff = api;
})(typeof globalThis === 'undefined' ? null : globalThis, () => {
    function postVersion(post) {
        return JSON.stringify(post);
    }

    function diffPosts(previousPosts, nextPosts) {
        const previousById = new Map(previousPosts.map(post => [post.id, postVersion(post)]));
        const nextById = new Map(nextPosts.map(post => [post.id, postVersion(post)]));
        const upsertedIds = nextPosts
            .filter(post => previousById.get(post.id) !== nextById.get(post.id))
            .map(post => post.id);
        const removedIds = previousPosts
            .filter(post => !nextById.has(post.id))
            .map(post => post.id);
        const orderChanged = previousPosts.length !== nextPosts.length
            || previousPosts.some((post, index) => post.id !== nextPosts[index]?.id);

        return {
            hasChanges: upsertedIds.length > 0 || removedIds.length > 0 || orderChanged,
            upsertedIds,
            removedIds,
            orderChanged
        };
    }

    return { diffPosts, postVersion };
});
