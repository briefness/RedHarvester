const test = require('node:test');
const assert = require('node:assert/strict');

const { diffPosts } = require('./post_diff');

const post = (id, updatedAt, title = `post-${id}`) => ({
    id,
    updated_at: updatedAt,
    original_title: title,
    status: 'AI_GENERATED'
});

test('identical polling responses do not trigger updates', () => {
    const posts = [post(2, '2026-07-24 12:00:00'), post(1, '2026-07-24 11:00:00')];

    const changes = diffPosts(posts, posts.map(item => ({ ...item })));

    assert.equal(changes.hasChanges, false);
    assert.deepEqual(changes.upsertedIds, []);
    assert.deepEqual(changes.removedIds, []);
});

test('adding a post leaves existing posts untouched', () => {
    const previous = [post(2, '2026-07-24 12:00:00'), post(1, '2026-07-24 11:00:00')];
    const next = [post(3, '2026-07-24 13:00:00'), ...previous];

    const changes = diffPosts(previous, next);

    assert.deepEqual(changes.upsertedIds, [3]);
    assert.deepEqual(changes.removedIds, []);
    assert.equal(changes.orderChanged, true);
});

test('updating one post only marks that post for replacement', () => {
    const previous = [post(2, '2026-07-24 12:00:00'), post(1, '2026-07-24 11:00:00')];
    const next = [post(2, '2026-07-24 12:01:00', 'changed'), previous[1]];

    const changes = diffPosts(previous, next);

    assert.deepEqual(changes.upsertedIds, [2]);
    assert.deepEqual(changes.removedIds, []);
    assert.equal(changes.orderChanged, false);
});

test('removing a post reports only the removed id', () => {
    const previous = [post(2, '2026-07-24 12:00:00'), post(1, '2026-07-24 11:00:00')];

    const changes = diffPosts(previous, [previous[0]]);

    assert.deepEqual(changes.upsertedIds, []);
    assert.deepEqual(changes.removedIds, [1]);
    assert.equal(changes.hasChanges, true);
});
