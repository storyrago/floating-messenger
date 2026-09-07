// 검증 하네스가 429에서 진짜로 멈추는지, 대상 없이 전송하지 않는지 확인한다.
// 하네스가 인스타에 요청을 얼마나 보내는지가 이 파일의 관심사다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { format } = require('node:util');
const { runSendTest } = require('../app/send-test.js');

const fast = { settleMs: 0, gapMs: 0, log: () => {} };
const ok = (body) => ({ status: 200, type: 'application/json', body });
const INBOX = ok({
  inbox: { threads: [{ thread_id: '99', thread_title: 'a', last_activity_at: 1700000000000000, read_state: 1, items: [{ item_id: 'i1', item_type: 'text', timestamp: 1700000000000000 }] }] },
  viewer: { pk: '1' },
});
const THREAD = ok({ thread: { thread_id: '99', viewer_id: '1', items: [], has_older: false } });

test('429가 나오면 즉시 멈추고 더 요청하지 않는다', async () => {
  const calls = [];
  await runSendTest({
    ...fast,
    get: async (p) => { calls.push(p); return { status: 429, type: 'text/html', body: null }; },
    post: async (p) => { calls.push(p); return ok({}); },
    threadId: '99',
  });
  assert.equal(calls.length, 1, '429 뒤에 추가 요청이 나가면 안 된다');
});

test('대상 스레드가 없으면 전송하지 않는다', async () => {
  const posts = [];
  const done = await runSendTest({
    ...fast,
    get: async (p) => (p.includes('/inbox/') ? INBOX : THREAD),
    post: async (p) => { posts.push(p); return ok({}); },
    threadId: undefined,
  });
  assert.equal(done, true);
  assert.deepEqual(posts, [], '대상이 없으면 POST가 한 건도 나가면 안 된다');
});

test('대상이 있으면 전송하고 item_id로 읽음까지 간다', async () => {
  const posts = [];
  await runSendTest({
    ...fast,
    get: async (p) => (p.includes('/inbox/') ? INBOX : THREAD),
    post: async (p, form) => {
      posts.push({ p, form });
      return p.includes('broadcast') ? ok({ status: 'ok', payload: { item_id: 'srv1', timestamp: 1700000000000000, client_context: form.client_context } }) : ok({ status: 'ok' });
    },
    threadId: '99',
  });
  assert.equal(posts.length, 2);
  assert.match(posts[0].p, /broadcast\/text\/$/);
  assert.equal(posts[0].form.thread_ids, '["99"]');
  assert.equal(posts[0].form.client_context, posts[0].form.mutation_token, 'client_context와 mutation_token은 같은 값이어야 한다');
  assert.match(posts[1].p, /items\/srv1\/seen\/$/);
});

test('전송이 실패하면 읽음 단계로 가지 않는다', async () => {
  const posts = [];
  await runSendTest({
    ...fast,
    get: async (p) => (p.includes('/inbox/') ? INBOX : THREAD),
    post: async (p) => { posts.push(p); return { status: 404, type: 'text/html', body: null }; },
    threadId: '99',
  });
  assert.equal(posts.length, 1, '전송 실패 뒤 읽음 요청이 나가면 안 된다');
});

test('로그에 보낸 본문이나 스레드 전체 id가 새지 않는다', async () => {
  const lines = [];
  await runSendTest({
    settleMs: 0, gapMs: 0,
    log: (...a) => lines.push(format(...a)), // console.log와 같은 방식으로 합친다
    get: async (p) => (p.includes('/inbox/') ? INBOX : THREAD),
    post: async () => ok({ status: 'ok', payload: { item_id: 'srv1' } }),
    threadId: '928630582842877',
  });
  const joined = lines.join('\n');
  assert.ok(!joined.includes('928630582842877'), '스레드 id 전체가 로그에 남으면 안 된다');
  assert.ok(joined.includes('…2877'), '뒤 4자리만 남아야 한다');
});
