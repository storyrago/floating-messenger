// send-test.js — 인스타 엔드포인트 검증 하네스 (임시).
//
// `npm run send-test` 으로만 돈다. 평소 실행에는 영향이 없다.
// docs/04 §A1.5. 검증이 끝나 결과를 docs/02 §9.1에 적고 나면 이 파일을 통째로 지운다.
//
// 원칙 셋. 오늘(2026-09-07) 요청 제한에 걸린 경험에서 나왔다.
//   1. 한 단계에 요청 1건. 단계 사이 60초.
//   2. 429가 한 번이라도 보이면 즉시 전부 중단한다. 재시도하지 않는다.
//   3. 부작용이 있는 단계(전송)는 대상 스레드를 명시적으로 준 경우에만 돈다.
'use strict';

const STEP_GAP_MS = 60_000;   // 단계 사이 간격
const SETTLE_MS = 120_000;    // 첫 성공 후 이만큼 안정돼야 시작한다
const TEST_TEXT = 'buoy send test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 응답에서 이름·본문을 빼고 "모양"만 남긴다. 로그에 대화 내용이 새지 않게 한다. */
function shapeOf(v, depth = 0) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return { array: v.length, first: v.length && depth < 2 ? shapeOf(v[0], depth + 1) : undefined };
  if (typeof v === 'object') return depth < 2 ? Object.keys(v) : `{${Object.keys(v).length} keys}`;
  if (typeof v === 'string') return `string(${v.length})`;
  if (typeof v === 'number') return `number(${String(v).length}자리)`;
  return typeof v;
}

function clientContext() {
  return String(Date.now()) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
}

/**
 * @param {object} io
 * @param {(path:string)=>Promise<{status:number,type:string,body:any}>} io.get
 * @param {(path:string,form:object)=>Promise<{status:number,type:string,body:any,error?:string}>} io.post
 * @param {(...a:any[])=>void} io.log
 * @param {string|undefined} io.threadId  전송 대상. 없으면 전송·읽음 단계를 건너뛴다
 * @param {number} [io.settleMs]  기본 SETTLE_MS. 테스트에서만 줄인다
 * @param {number} [io.gapMs]     기본 STEP_GAP_MS. 테스트에서만 줄인다
 */
async function runSendTest({ get, post, log, threadId, settleMs = SETTLE_MS, gapMs = STEP_GAP_MS }) {
  log('검증 시작. 첫 성공 후 %d초 안정을 기다립니다.', settleMs / 1000);
  await sleep(settleMs);

  const stop = (why) => { log('■ 중단:', why); return false; };

  // ── 1. 목록 조회 (부작용 없음) ──
  log('[1/4] 목록 조회');
  const inbox = await get('/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=10&thread_message_limit=10');
  if (inbox.status === 429) return stop('429 — 30분 이상 쉬고 다시 하세요');
  if (!inbox.body) return stop(`목록 조회 실패 http_${inbox.status} (${inbox.type})`);

  const threads = (inbox.body.inbox && inbox.body.inbox.threads) || [];
  log('  ok. 응답 모양:', {
    top: Object.keys(inbox.body),
    inbox: shapeOf(inbox.body.inbox),
    thread: shapeOf(threads[0]),
    item: shapeOf(threads[0] && threads[0].items && threads[0].items[0]),
    viewer: shapeOf(inbox.body.viewer),
  });
  const t0 = threads[0] || {};
  log('  단위 확인:', {
    'items[].timestamp': shapeOf(t0.items && t0.items[0] && t0.items[0].timestamp),
    last_activity_at: shapeOf(t0.last_activity_at),
    read_state: t0.read_state,
    item_type: t0.items && t0.items[0] && t0.items[0].item_type,
    thread_title_비었나: !t0.thread_title,
  });

  // ── 2. 대화 조회 (부작용 없음) ──
  const readId = t0.thread_id;
  if (!readId) return stop('스레드가 없어 대화 조회를 건너뜁니다');
  await sleep(gapMs);
  log('[2/4] 대화 조회');
  const thread = await get(`/api/v1/direct_v2/threads/${readId}/?limit=30`);
  if (thread.status === 429) return stop('429 — 30분 이상 쉬고 다시 하세요');
  if (!thread.body) return stop(`대화 조회 실패 http_${thread.status} (${thread.type})`);
  const th = thread.body.thread || {};
  log('  ok. 응답 모양:', {
    top: Object.keys(thread.body),
    thread: Object.keys(th),
    items: shapeOf(th.items),
    viewer_id: shapeOf(th.viewer_id),
    oldest_cursor: shapeOf(th.oldest_cursor),
    has_older: th.has_older,
  });

  // ── 3. 전송 (부작용 있음. 대상 스레드를 준 경우에만) ──
  if (!threadId) {
    log('[3/4] 전송 건너뜀 — 대상 스레드가 없습니다.');
    log('      사람이 있는 방에 자동으로 보내지 않습니다. 내 메모 방을 열고 주소창의 숫자를');
    log('      BUOY_SEND_TEST_THREAD 로 주면 그 방에만 보냅니다.');
    return true;
  }
  await sleep(gapMs);
  log('[3/4] 전송 → 스레드 …%s', String(threadId).slice(-4)); // 뒤 4자리만 남긴다
  const cc = clientContext();
  const sent = await post('/api/v1/direct_v2/threads/broadcast/text/', {
    action: 'send_item',
    client_context: cc,
    mutation_token: cc,
    offline_threading_id: cc,
    thread_ids: `["${threadId}"]`,
    text: TEST_TEXT,
    is_shh_mode: '0',
    send_attribution: 'direct_thread',
  });
  if (sent.status === 429) return stop('429 — 30분 이상 쉬고 다시 하세요');
  if (sent.error) return stop(sent.error);
  if (!sent.body) {
    log('  실패 http_%d (%s)', sent.status, sent.type);
    log('  404면 이 경로는 폐기하고 웹뷰 안 전송 경로로 설계를 바꿉니다(ADR 필요).');
    log('  400이면 아래 오류를 보고 파라미터를 한 번만 고쳐 재시도합니다.');
    return false;
  }
  const payload = sent.body.payload || {};
  log('  ok. status=%s payload=%o', sent.body.status, Object.keys(payload));
  log('  확정에 쓸 값:', {
    item_id: shapeOf(payload.item_id),
    timestamp: shapeOf(payload.timestamp),
    client_context_돌아옴: payload.client_context === cc,
  });
  log('  ※ 응답만 믿지 말고 앱과 폰에서 그 방에 "%s" 가 실제로 떴는지 확인하세요.', TEST_TEXT);

  // ── 4. 읽음 처리 ──
  if (!payload.item_id) return true;
  await sleep(gapMs);
  log('[4/4] 읽음 처리');
  const seen = await post(`/api/v1/direct_v2/threads/${threadId}/items/${payload.item_id}/seen/`, {
    thread_id: String(threadId),
    item_id: String(payload.item_id),
    action: 'mark_seen',
    client_context: clientContext(),
  });
  if (seen.status === 429) return stop('429 — 30분 이상 쉬고 다시 하세요');
  log('  status=%d type=%s body=%o', seen.status, seen.type, seen.body && Object.keys(seen.body));
  return true;
}

module.exports = { runSendTest, SETTLE_MS, STEP_GAP_MS };
