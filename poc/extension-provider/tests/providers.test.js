const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/providers.js');

test('nsId / parseId roundtrip and unknown provider', () => {
  assert.equal(P.nsId('instagram', '340282366841710300949128'), 'instagram:340282366841710300949128');
  assert.deepEqual(P.parseId('instagram:340282366841710300949128'), { provider: 'instagram', id: '340282366841710300949128' });
  assert.deepEqual(P.parseId('instagram:a:b'), { provider: 'instagram', id: 'a:b' }); // 첫 콜론만 자른다
  assert.deepEqual(P.parseId('nope:1'), { provider: null, id: 'nope:1' });
  assert.deepEqual(P.parseId('콜론없음'), { provider: null, id: '콜론없음' });
  assert.throws(() => P.nsId('line', '1'));
});

test('capsFor: instagram은 고정, 모르는 프로바이더는 아무 기능 없음', () => {
  assert.deepEqual(P.capsFor('instagram'), { send: true, seen: true, history: true, rooms: true });
  assert.deepEqual(P.capsFor('nope'), P.NO_CAPS);
});

test('tagInstagramInbox namespaces ids and keeps rawId', () => {
  const out = P.tagInstagramInbox({ threads: [{ id: '1', title: 'a', items: [{ id: 'i1', ts: 5 }], lastActivity: 5 }] });
  assert.equal(out[0].id, 'instagram:1');
  assert.equal(out[0].rawId, '1');
  assert.equal(out[0].provider, 'instagram');
  assert.equal(out[0].items[0].provider, 'instagram');
  assert.deepEqual(P.tagInstagramInbox(null), []);
  assert.deepEqual(P.tagInstagramInbox({}), []);
});

test('mergeThreads: lastActivity 내림차순, countUnread, filterThreads', () => {
  const inbox = {
    threads: [
      { id: 'old', title: '오래된', items: [], lastActivity: 100, unread: false },
      { id: 'new', title: '최근', items: [], lastActivity: 300, unread: true },
      { id: 'mid', title: '중간', items: [], lastActivity: 200, unread: true },
    ],
  };
  const merged = P.mergeThreads({ instagram: { inbox } });
  assert.deepEqual(merged.map((t) => t.rawId), ['new', 'mid', 'old']);

  assert.deepEqual(P.countUnread(merged), { total: 2, byProvider: { instagram: 2 } });

  assert.equal(P.filterThreads(merged, 'all').length, 3);
  assert.equal(P.filterThreads(merged, 'instagram').length, 3);
  assert.equal(P.filterThreads(merged, 'nope').length, 0);

  assert.deepEqual(P.mergeThreads({}), []);
});

test('overallStatus', () => {
  assert.equal(P.overallStatus({ instagram: 'connected' }), 'connected');
  assert.equal(P.overallStatus({ instagram: 'disconnected' }), 'disconnected');
  assert.equal(P.overallStatus({}), 'disconnected');
});
