/**
 * Навантажувальний тест: запускає зібраний застосунок (dist) окремим процесом
 * і проганяє сценарії autocannon. Результат — reports/perf.json і таблиця в консоль.
 *   PERF_DATABASE_URL=... npx tsx perf/load.ts [--duration 10] [--connections 20] [--repeat 3]
 *                                              [--label baseline] [--app <каталог зі збіркою>]
 * --only <текст>      лише сценарії, у назві яких є цей текст
 * --budget-p99 <мс>   код виходу 1, якщо p99 будь-якого сценарію більший або є помилки (CI).
 * Кожен сценарій: прогрів 2 с, потім --repeat прогонів; у звіт іде медіана
 * (на спільних 2 ядрах один прогін шумить на ±15 %).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import autocannon from 'autocannon';
import pg from 'pg';
import { PERF } from './config.js';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const duration = Number(opt('--duration', '10'));
const connections = Number(opt('--connections', '20'));
const label = opt('--label', 'run');
const repeat = Number(opt('--repeat', '3'));
const appDir = opt('--app', '.');
const output = opt('--out', 'reports/perf.json');
const only = opt('--only', '');
const budgetP99 = args.includes('--budget-p99') ? Number(opt('--budget-p99', '0')) : null;
const url = process.env.PERF_DATABASE_URL;
if (!url) throw new Error('PERF_DATABASE_URL is required');
const PORT = 3999;
const base = `http://localhost:${PORT}`;

interface Scenario {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  user?: string;
  body?: string;
  /** Для DELETE: кожен запит — наступний id із цього списку; міряємо кількістю запитів. */
  ids?: string[];
}

/** Усі ендпоінти API (spec §7: p99 кожного ендпоінта ≤ бюджету). */
async function scenarios(): Promise<Scenario[]> {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const withNotes = await db.query<{ id: string }>(
    `SELECT e.id FROM entries e JOIN therapist_notes n ON n.entry_id = e.id
     WHERE e.client_id = $1 GROUP BY e.id ORDER BY count(*) DESC, e.id LIMIT 1`,
    [PERF.heavyClient],
  );
  const active = await db.query<{ id: string }>(
    `SELECT id FROM entries WHERE client_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [PERF.heavyClient],
  );
  const toDelete = await db.query<{ id: string }>(
    'SELECT id FROM entries WHERE client_id = $1 AND deleted_at IS NULL ORDER BY id',
    [PERF.deleteClient],
  );
  await db.end();
  const c = PERF.heavyClient;
  const t = PERF.therapist;
  const entryWithNotes = withNotes.rows[0]?.id;
  const activeEntry = active.rows[0]?.id;
  const entryBody = JSON.stringify({
    situation: 'Навантаження',
    thought: 'Думка',
    emotion: 'тривога',
    emotion_intensity: 40,
  });
  return [
    { name: 'Службове: /health', method: 'GET', path: '/health' },
    { name: 'Службове: /version', method: 'GET', path: '/version' },
    { name: 'Клієнт: свої записи, 1-ша сторінка', method: 'GET', path: '/client/entries', user: c },
    {
      name: 'Клієнт: свої записи, глибока сторінка',
      method: 'GET',
      path: '/client/entries?limit=50&offset=1500',
      user: c,
    },
    { name: 'Клієнт: один запис', method: 'GET', path: `/client/entries/${activeEntry}`, user: c },
    { name: 'Клієнт: свій терапевт', method: 'GET', path: '/client/therapist', user: c },
    {
      name: 'Клієнт: новий запис',
      method: 'POST',
      path: '/client/entries',
      user: c,
      body: entryBody,
    },
    {
      name: 'Клієнт: видалення запису',
      method: 'DELETE',
      path: '/client/entries/:id',
      user: PERF.deleteClient,
      ids: toDelete.rows.map((r) => r.id),
    },
    { name: 'Терапевт: список клієнтів', method: 'GET', path: '/therapist/clients', user: t },
    {
      name: 'Терапевт: записи клієнта',
      method: 'GET',
      path: `/therapist/clients/${c}/entries`,
      user: t,
    },
    {
      name: 'Терапевт: нотатки до запису',
      method: 'GET',
      path: `/therapist/entries/${entryWithNotes}/notes`,
      user: t,
    },
    {
      name: 'Терапевт: нова нотатка',
      method: 'POST',
      path: `/therapist/entries/${activeEntry}/notes`,
      user: t,
      body: JSON.stringify({ text: 'Нотатка під навантаженням' }),
    },
  ];
}

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* ще стартує */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const server = spawn('node', ['dist/index.js'], {
  cwd: appDir,
  env: {
    ...process.env,
    PORT: String(PORT),
    STORAGE: 'postgres',
    DATABASE_URL: url,
    LOG_LEVEL: 'info',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

try {
  await waitForHealth();
  const results = [];
  for (const s of (await scenarios()).filter((x) => x.name.includes(only))) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s.user) headers['X-User-Id'] = s.user;
    const ids = s.ids ?? [];
    let next = 0;
    // Час прогону міряємо самі: autocannon округлює duration до секунд
    // (8000 DELETE за 4,6 с показував як «4 с» і 2000 rps).
    const run = async (seconds: number, amount?: number) => {
      const started = performance.now();
      const result = await autocannon({
        url: `${base}${s.path}`,
        method: s.method,
        headers,
        body: s.body,
        connections,
        ...(s.ids
          ? {
              amount,
              requests: [
                {
                  setupRequest: (req) => ({ ...req, path: `/client/entries/${ids[next++]}` }),
                },
              ],
            }
          : { duration: seconds }),
      });
      return { ...result, elapsedSeconds: (performance.now() - started) / 1000 };
    };
    const needed = PERF.deleteWarmupRequests + repeat * PERF.deleteRequestsPerRun;
    if (s.ids && ids.length < needed) {
      throw new Error(`DELETE scenario needs ${needed} entries, prepared ${ids.length}`);
    }
    // Прогрів: JIT, пул з'єднань, кеш сторінок PostgreSQL.
    await run(2, PERF.deleteWarmupRequests);
    const runs = [];
    for (let i = 0; i < repeat; i++) runs.push(await run(duration, PERF.deleteRequestsPerRun));
    if (process.env.PERF_DEBUG) {
      for (const r of runs) {
        process.stderr.write(
          `${s.name}: total=${r.requests.total} elapsed=${r.elapsedSeconds.toFixed(2)}s non2xx=${r.non2xx}\n`,
        );
      }
    }
    const errors = runs.reduce((a, r) => a + r.errors + r.non2xx, 0);
    results.push({
      name: s.name,
      method: s.method,
      path: s.path,
      rps: Math.round(median(runs.map((r) => r.requests.total / r.elapsedSeconds))),
      p50: median(runs.map((r) => r.latency.p50)),
      p90: median(runs.map((r) => r.latency.p90)),
      p99: median(runs.map((r) => r.latency.p99)),
      max: Math.max(...runs.map((r) => r.latency.max)),
      requests: runs.reduce((a, r) => a + r.requests.total, 0),
      errors,
      ok: errors === 0,
    });
  }
  const report = {
    label,
    at: new Date().toISOString(),
    duration,
    connections,
    repeat,
    cpus: (await import('node:os')).cpus().length,
    budgetP99,
    results,
  };
  mkdirSync('reports', { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
  const pad = (v: unknown, n: number) => String(v).padStart(n);
  process.stdout.write(
    `\n${label}: ${connections} connections, median of ${repeat} × ${duration}s per scenario\n`,
  );
  process.stdout.write(
    `${'scenario'.padEnd(42)}${pad('rps', 7)}${pad('p50', 7)}${pad('p90', 7)}${pad('p99', 7)}${pad('err', 6)}\n`,
  );
  for (const r of results) {
    process.stdout.write(
      `${r.name.padEnd(42)}${pad(r.rps, 7)}${pad(r.p50, 7)}${pad(r.p90, 7)}${pad(r.p99, 7)}${pad(r.errors, 6)}\n`,
    );
  }
  if (budgetP99 !== null) {
    const over = results.filter((r) => r.p99 > budgetP99 || r.errors > 0);
    for (const r of over) {
      process.stdout.write(`OVER BUDGET  ${r.name}: p99 ${r.p99} ms, errors ${r.errors}\n`);
    }
    process.stdout.write(
      over.length === 0
        ? `budget ok: every scenario p99 <= ${budgetP99} ms, no errors\n`
        : `budget exceeded in ${over.length} scenario(s)\n`,
    );
    process.exitCode = over.length === 0 ? 0 : 1;
  }
} finally {
  server.kill('SIGTERM');
}
