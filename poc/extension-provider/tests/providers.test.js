const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/providers.js');

test('nsId / parseId roundtrip and unknown provider', () => {
  assert.equal(P.nsId('kakao', '가족방'), 'kakao:가족방');
  assert.deepEqual(P.parseId('instagram:340282366841710300949128'), { provider: 'instagram', id: '340282366841710300949128' });
  assert.deepEqual(P.parseId('kakao:a:b'), { provider: 'kakao', id: 'a:b' });
  assert.deepEqual(P.parseId('nope:1'), { provider: null, id: 'nope:1' });
  assert.throws(() => P.nsId('line', '1'));
});

test('capsFor: instagram fixed, kakao trusts host but defaults false', () => {
  assert.deepEqual(P.capsFor('instagram'), { send: true, seen: true, history: true, rooms: true });
  assert.deepEqual(P.capsFor('kakao', { send: true }), { send: true, seen: false, history: false, rooms: false });
  assert.deepEqual(P.capsFor('kakao', undefined), P.NO_CAPS);
});

test('tagInstagramInbox namespaces ids and keeps rawId', () => {
  const out = P.tagInstagramInbox({ threads: [{ id: '1', title: 'a', items: [{ id: 'i1', ts: 5 }], lastActivity: 5 }] });
  assert.equal(out[0].id, 'instagram:1');
  assert.equal(out[0].rawId, '1');
  assert.equal(out[0].items[0].provider, 'instagram');
  assert.deepEqual(P.tagInstagramInbox(null), []);
});

test('applyKakaoItem creates thread, dedupes, marks unread unless open', () => {
  const map = new Map();
  const item = { id: 'x1', roomId: '가족방', roomName: '가족방', sender: '엄마', text: '밥', ts: 1000, fromMe: false, source: 'toast' };
  const t = P.applyKakaoItem(map, item);
  assert.equal(t.id, 'kakao:가족방');
  assert.equal(t.items.length, 1);
  assert.equal(t.unread, true);
  assert.equal(t.last.text, '밥');
  // 중복 id 무시
  P.applyKakaoItem(map, item);
  assert.equal(t.items.length, 1);
  // 열려 있는 방이면 unread 안 됨
  t.unread = false;
  P.applyKakaoItem(map, { ...item, id: 'x2', ts: 2000 }, { isOpen: (id) => id === 'kakao:가족방' });
  assert.equal(t.unread, false);
  assert.equal(t.lastActivity, 2000);
  // 두 번째 발신자 → 그룹
  P.applyKakaoItem(map, { ...item, id: 'x3', ts: 3000, sender: '아빠' });
  assert.equal(t.isGroup, true);
  assert.deepEqual(t.users.map((u) => u.username), ['엄마', '아빠']);
});

test('applyKakaoItem sorts by ts and caps item count', () => {
  const map = new Map();
  for (let i = 0; i < 5; i++) P.applyKakaoItem(map, { id: 'k' + i, roomId: 'r', text: String(i), ts: 100 - i }, { maxItems: 3 });
  const t = map.get('kakao:r');
  assert.deepEqual(t.items.map((x) => x.text), ['2', '1', '0']);
});

test('mergeThreads sorts across providers by lastActivity; countUnread and filter', () => {
  const kk = new Map();
  P.applyKakaoItem(kk, { id: 'a', roomId: 'r', text: 'hi', ts: 50 });
  const merged = P.mergeThreads({
    instagram: { inbox: { threads: [{ id: '1', title: 'ig', items: [], lastActivity: 100, unread: true }, { id: '2', title: 'ig2', items: [], lastActivity: 10, unread: false }] } },
    kakao: { threads: kk },
  });
  assert.deepEqual(merged.map((t) => t.id), ['instagram:1', 'kakao:r', 'instagram:2']);
  assert.deepEqual(P.countUnread(merged), { total: 2, byProvider: { instagram: 1, kakao: 1 } });
  assert.deepEqual(P.filterThreads(merged, 'kakao').map((t) => t.id), ['kakao:r']);
  assert.equal(P.filterThreads(merged, 'all').length, 3);
});

test('overallStatus', () => {
  assert.equal(P.overallStatus({}), 'disconnected');
  assert.equal(P.overallStatus({ instagram: 'connected' }), 'connected');
  assert.equal(P.overallStatus({ instagram: 'connected', kakao: 'disconnected' }), 'degraded');
  assert.equal(P.overallStatus({ instagram: 'logged_out', kakao: 'disconnected' }), 'disconnected');
});

test('optimisticKakaoItem shape', () => {
  const it = P.optimisticKakaoItem('hi', 123);
  assert.ok(it.id.startsWith('tmp_123'));
  assert.equal(it.pending, true);
  assert.equal(it.fromMe, true);
});
