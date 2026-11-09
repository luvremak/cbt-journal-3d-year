#!/usr/bin/env node
/**
 * Smoke-перевірка живого сервера за головними сценаріями spec (на seed-користувачах).
 * Використання:
 *   node scripts/smoke.mjs <baseUrl> [--wait 120] [--expect-commit <sha>]
 * --wait            скільки секунд чекати, поки /health відповість 200 (холодний старт Render)
 * --expect-commit   чекати, поки /version покаже цей коміт (новий деплой піднявся)
 * Створює й видаляє один запис від імені тестового клієнта. Код виходу 1 — якщо щось не так.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/$/, '');
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const waitSeconds = Number(opt('--wait') ?? 30);
const expectCommit = opt('--expect-commit');

const THERAPIST = '11111111-1111-4111-8111-111111111111'; // Олена
const CLIENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Максим

let failures = 0;
const ok = (name) => process.stdout.write(`ok    ${name}\n`);
const fail = (name, detail) => {
  failures++;
  process.stdout.write(`FAIL  ${name}: ${detail}\n`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, user, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['X-User-Id'] = user;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function check(name, fn) {
  try {
    const problem = await fn();
    if (problem) fail(name, problem);
    else ok(name);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

async function waitFor(name, predicate) {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result === true) return ok(name);
      last = result;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(3000);
  }
  fail(name, `gave up after ${waitSeconds}s: ${last}`);
}

await waitFor('GET /health → 200', async () => {
  const r = await call('GET', '/health');
  return r.status === 200 || `status ${r.status}`;
});

if (expectCommit) {
  await waitFor(`GET /version shows commit ${expectCommit.slice(0, 7)}`, async () => {
    const r = await call('GET', '/version');
    return r.body?.commit === expectCommit || `commit is ${r.body?.commit}`;
  });
}

await check('GET /version', async () => {
  const r = await call('GET', '/version');
  if (r.status === 404 && !expectCommit) {
    process.stdout.write('      /version not available (older build)\n');
    return null;
  }
  if (r.status !== 200) return `status ${r.status}`;
  process.stdout.write(`      ${JSON.stringify(r.body)}\n`);
  return null;
});

if (failures === 0) {
  await check('no X-User-Id → 401', async () => {
    const r = await call('GET', '/client/entries');
    return r.status === 401 ? null : `status ${r.status}`;
  });
  await check('client on therapist endpoint → 403', async () => {
    const r = await call('GET', '/therapist/clients', CLIENT);
    return r.status === 403 ? null : `status ${r.status}`;
  });

  let entryId;
  await check('client creates an entry → 201', async () => {
    const r = await call('POST', '/client/entries', CLIENT, {
      situation: 'smoke',
      thought: 'smoke',
      emotion: 'спокій',
      emotion_intensity: 10,
    });
    entryId = r.body?.id;
    return r.status === 201 && entryId ? null : `status ${r.status}`;
  });
  await check('client sees it in the list', async () => {
    const r = await call('GET', '/client/entries?limit=100', CLIENT);
    return r.body?.some?.((e) => e.id === entryId) ? null : 'entry not in list';
  });
  await check('client sees own therapist', async () => {
    const r = await call('GET', '/client/therapist', CLIENT);
    return r.body?.id === THERAPIST ? null : `got ${JSON.stringify(r.body)}`;
  });
  await check('therapist sees the client', async () => {
    const r = await call('GET', '/therapist/clients', THERAPIST);
    return r.body?.some?.((c) => c.id === CLIENT) ? null : 'client not in list';
  });
  await check('therapist adds a note → 201', async () => {
    const r = await call('POST', `/therapist/entries/${entryId}/notes`, THERAPIST, {
      text: 'smoke',
    });
    return r.status === 201 ? null : `status ${r.status}`;
  });
  await check('client deletes the entry → 204', async () => {
    const r = await call('DELETE', `/client/entries/${entryId}`, CLIENT);
    return r.status === 204 ? null : `status ${r.status}`;
  });
  await check('note on the deleted entry → 409', async () => {
    const r = await call('POST', `/therapist/entries/${entryId}/notes`, THERAPIST, { text: 'x' });
    return r.status === 409 ? null : `status ${r.status}`;
  });
  await check('therapist sees the deleted entry without content', async () => {
    const r = await call('GET', `/therapist/clients/${CLIENT}/entries?limit=100`, THERAPIST);
    const e = r.body?.find?.((x) => x.id === entryId);
    if (!e) return 'entry not in list';
    return e.deleted === true && e.situation === undefined ? null : JSON.stringify(e);
  });
}

process.stdout.write(failures === 0 ? 'smoke: all good\n' : `smoke: ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
