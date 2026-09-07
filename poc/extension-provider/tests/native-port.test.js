const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeLink } = require('../lib/native-port.js');

// chrome.runtime.Port 흉내. 호스트 역할은 테스트가 한다.
function fakePort() {
  const msgListeners = [];
  const discListeners = [];
  const sent = [];
  return {
    sent,
    postMessage: (m) => sent.push(m),
    onMessage: { addListener: (f) => msgListeners.push(f) },
    onDisconnect: { addListener: (f) => discListeners.push(f) },
    disconnect() { /* Chrome: 내가 끊을 때는 내 onDisconnect가 오지 않는다 */ },
    // 테스트용
    receive: (m) => msgListeners.forEach((f) => f(m)),
    drop: () => discListeners.forEach((f) => f()),   // 상대(호스트)가 끊김
  };
}

const ACK = { type: 'HELLO_ACK', protocol: 1, adapter: 'mock', capabilities: { send: true, rooms: true } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('handshake: HELLO sent, HELLO_ACK → connected with caps', async () => {
  const ports = [];
  const states = [];
  const link = createNativeLink({ connect: () => { const p = fakePort(); ports.push(p); return p; }, onState: (s) => states.push(s.status) });
  link.start();
  assert.equal(ports[0].sent[0].type, 'HELLO');
  assert.equal(link.status, 'connecting');
  ports[0].receive(ACK);
  assert.equal(link.status, 'connected');
  assert.deepEqual(link.caps, { send: true, rooms: true });
  assert.equal(link.adapter, 'mock');
  link.stop();
  assert.deepEqual(states, ['connecting', 'connected', 'stopped']);
});

test('request/response correlation, ERROR rejects, timeout rejects', async () => {
  const p = fakePort();
  const link = createNativeLink({ connect: () => p, requestTimeoutMs: 30 });
  link.start(); p.receive(ACK);

  const ping = link.ping();
  const sendReq = link.send('room', 'hi');
  const [pingMsg, sendMsg] = p.sent.slice(1);
  assert.equal(pingMsg.type, 'PING');
  assert.equal(sendMsg.type, 'SEND');
  assert.notEqual(pingMsg.reqId, sendMsg.reqId);

  p.receive({ type: 'SEND_RESULT', reqId: sendMsg.reqId, ok: true });   // 순서가 바뀌어도 맞는 요청에 간다
  p.receive({ type: 'PONG', reqId: pingMsg.reqId, ts: 1 });
  assert.equal((await ping).type, 'PONG');
  assert.equal((await sendReq).ok, true);

  const rooms = link.listRooms();
  const roomsMsg = p.sent[p.sent.length - 1];
  p.receive({ type: 'ERROR', reqId: roomsMsg.reqId, error: 'boom' });
  await assert.rejects(rooms, /boom/);

  const slow = link.ping();
  await assert.rejects(slow, /timeout/);
  assert.equal(link.pendingCount, 0);
  link.stop();
});

test('request while not connected rejects immediately', async () => {
  const link = createNativeLink({ connect: () => fakePort() });
  await assert.rejects(link.ping(), /not connected/);
});

test('disconnect → pending rejected → reconnect after backoff → handshake again; stop cancels', async () => {
  const ports = [];
  const states = [];
  const link = createNativeLink({
    connect: () => { const p = fakePort(); ports.push(p); return p; },
    onState: (s) => states.push([s.status, s.error, s.retryInMs]),
    getLastError: () => 'Specified native messaging host not found.',
    backoffMs: [10, 20],
  });
  link.start(); ports[0].receive(ACK);
  const inflight = link.ping();
  ports[0].drop();
  await assert.rejects(inflight, /disconnected/);
  assert.equal(link.status, 'disconnected');
  assert.equal(link.attempt, 1);
  await sleep(25);
  assert.equal(ports.length, 2, 'reconnected once');
  assert.equal(ports[1].sent[0].type, 'HELLO');
  ports[1].drop();               // 두 번째 실패 → 20ms 뒤 재시도
  assert.equal(link.attempt, 2);
  link.stop();                   // 재시도 취소
  await sleep(40);
  assert.equal(ports.length, 2, 'no reconnect after stop');
  assert.equal(link.status, 'stopped');
  const disc = states.find((s) => s[0] === 'disconnected');
  assert.match(disc[1], /not found/);
  assert.equal(disc[2], 10);
});

test('HELLO_ACK timeout counts as failure and retries', async () => {
  const ports = [];
  const states = [];
  const link = createNativeLink({ connect: () => { const p = fakePort(); ports.push(p); return p; }, helloTimeoutMs: 10, backoffMs: [5], onState: (s) => states.push(s) });
  link.start();
  await sleep(30);
  assert.ok(ports.length >= 2, 'retried after hello timeout');
  assert.ok(link.attempt >= 1);
  assert.ok(states.some((s) => s.status === 'disconnected' && /HELLO_ACK timeout/.test(s.error)));
  link.stop();
});

test('maxAttempts gives up', async () => {
  const link = createNativeLink({ connect: () => { throw new Error('no host'); }, backoffMs: [1], maxAttempts: 2 });
  link.start();
  await sleep(20);
  assert.equal(link.status, 'stopped');
});

test('events are routed to onEvent', () => {
  const p = fakePort();
  const events = [];
  const link = createNativeLink({ connect: () => p, onEvent: (m) => events.push(m.type) });
  link.start(); p.receive(ACK);
  p.receive({ type: 'ITEM', item: { id: '1' } });
  p.receive({ type: 'STATUS', status: 'degraded' });
  p.receive({ type: 'ERROR', error: 'unsolicited' });
  assert.deepEqual(events, ['HELLO_ACK', 'ITEM', 'STATUS', 'ERROR']);
  link.stop();
});
