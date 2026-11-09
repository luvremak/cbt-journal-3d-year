#!/usr/bin/env node
/**
 * Звіт якості: одна самодостатня HTML-сторінка з результатами тестів, покриття,
 * мутаційного тестування (Stryker) і SQL-мутантів. Шрифти вбудовано, тож файл
 * відкривається без інтернету.
 *
 * Джерела (будь-яке може бути відсутнім — тоді розділу не буде):
 *   reports/tests.json              — vitest --reporter=json
 *   reports/coverage/coverage-summary.json — vitest coverage, json-summary
 *   reports/mutation/mutation.json  — Stryker json reporter
 *   reports/sql-mutation.json       — scripts/sql-mutation.sh
 * Результат: reports/index.html
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const at = (p) => resolve(root, p);
const readJson = (p) => (existsSync(at(p)) ? JSON.parse(readFileSync(at(p), 'utf8')) : null);

const tests = readJson('reports/tests.json');
const coverage = readJson('reports/coverage/coverage-summary.json');
const mutation = readJson('reports/mutation/mutation.json');
const sql = readJson('reports/sql-mutation.json');

// ---------- helpers ----------

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (n) => `<span class="n">${esc(n)}</span>`;
const pct = (n) => `${n.toFixed(2).replace('.', ',')}\u202f%`;

/** Українські форми множини: [1, 2–4, 5+]. */
function plural(n, [one, few, many]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
/** Родовий після «із»: із 21 мутанта, із 5 мутантів. */
const genitive = (n, [one, many]) => (n % 10 === 1 && n % 100 !== 11 ? one : many);

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function font(file, family, weight) {
  const path = at(`node_modules/@fontsource/${file}`);
  if (!existsSync(path)) return '';
  const data = readFileSync(path).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
}
const fonts = [
  ...[300, 400, 500].flatMap((w) => [
    font(`spectral/files/spectral-latin-${w}-normal.woff2`, 'Spectral', w),
    font(`spectral/files/spectral-cyrillic-${w}-normal.woff2`, 'Spectral', w),
  ]),
  ...[400, 500].flatMap((w) => [
    font(`jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`, 'JetBrains Mono', w),
    font(`jetbrains-mono/files/jetbrains-mono-cyrillic-${w}-normal.woff2`, 'JetBrains Mono', w),
  ]),
].join('\n');

// ---------- tests ----------

const LEVELS = [
  ['unit', 'Unit', 'Логіка сервісів, валідація, DI — без бази'],
  ['integration', 'Інтеграційні', 'Репозиторії, обмеження й атомарність на PostgreSQL'],
  ['e2e', 'E2E', 'Сценарії spec через HTTP, обидва сховища'],
];

function summarizeTests() {
  if (!tests) return null;
  const byLevel = Object.fromEntries(
    LEVELS.map(([k]) => [k, { passed: 0, failed: 0, skipped: 0 }]),
  );
  const failures = [];
  let specLinked = 0;
  for (const file of tests.testResults) {
    const rel = relative(root, file.name);
    const level = LEVELS.find(([k]) => rel.startsWith(`test/${k}/`))?.[0];
    for (const t of file.assertionResults) {
      if (/spec §/.test(t.fullName)) specLinked++;
      if (!level) continue;
      if (t.status === 'passed') byLevel[level].passed++;
      else if (t.status === 'failed') {
        byLevel[level].failed++;
        failures.push({ file: rel, name: t.fullName });
      } else byLevel[level].skipped++;
    }
  }
  return {
    total: tests.numTotalTests,
    passed: tests.numPassedTests,
    failed: tests.numFailedTests,
    skipped: tests.numPendingTests + (tests.numTodoTests ?? 0),
    byLevel,
    failures,
    specLinked,
  };
}

// ---------- mutation ----------

const STATUS = {
  Killed: { label: 'убито', cls: 'killed' },
  Timeout: { label: 'таймаут (убито)', cls: 'timeout' },
  Survived: { label: 'вижив', cls: 'survived' },
  NoCoverage: { label: 'без покриття', cls: 'nocov' },
  Ignored: { label: 'пропущено', cls: 'ignored' },
  CompileError: { label: 'не компілюється', cls: 'ignored' },
  RuntimeError: { label: 'помилка запуску', cls: 'ignored' },
};

function summarizeMutation() {
  if (!mutation) return null;
  const testNames = new Map();
  for (const tf of Object.values(mutation.testFiles ?? {})) {
    for (const t of tf.tests) testNames.set(t.id, t.name);
  }
  const files = Object.entries(mutation.files)
    .map(([path, f]) => {
      const lines = f.source.split('\n');
      const mutants = f.mutants
        .map((m) => ({ ...m, line: lines[m.location.start.line - 1] ?? '' }))
        .sort(
          (a, b) =>
            a.location.start.line - b.location.start.line ||
            a.location.start.column - b.location.start.column,
        );
      const c = count(mutants);
      return { path, mutants, ...c };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const all = files.flatMap((f) => f.mutants);
  return { files, ...count(all), thresholds: mutation.thresholds, testNames };
}

function count(mutants) {
  const by = (s) => mutants.filter((m) => m.status === s).length;
  const killed = by('Killed');
  const timeout = by('Timeout');
  const survived = by('Survived');
  const noCoverage = by('NoCoverage');
  const ignored = mutants.length - killed - timeout - survived - noCoverage;
  const valid = killed + timeout + survived + noCoverage;
  return {
    total: mutants.length,
    killed,
    timeout,
    survived,
    noCoverage,
    ignored,
    valid,
    score: valid === 0 ? 100 : ((killed + timeout) / valid) * 100,
  };
}

// ---------- render: pieces ----------

function verdict(t, m) {
  if (m && t) {
    const dead = m.survived + m.noCoverage;
    const mutPart =
      dead === 0
        ? `Жоден із ${num(m.valid)} ${genitive(m.valid, ['мутанта', 'мутантів'])} не вижив`
        : `${plural(dead, ['Вижив', 'Вижили', 'Вижило'])} ${num(dead)} ${plural(dead, ['мутант', 'мутанти', 'мутантів'])} із ${num(m.valid)}`;
    const testPart =
      t.failed === 0
        ? `${t.passed === t.total ? 'усі' : ''} ${num(t.passed)} ${plural(t.passed, ['тест пройшов', 'тести пройшли', 'тестів пройшли'])}`
        : `${num(t.failed)} ${plural(t.failed, ['тест падає', 'тести падають', 'тестів падають'])}`;
    return `${mutPart}, ${testPart.trim()}.`;
  }
  if (m) return `Mutation score ${num(pct(m.score))}.`;
  if (t) return `${num(t.passed)} із ${num(t.total)} тестів пройшли.`;
  return 'Звітів ще немає.';
}

function lede(t, m) {
  const parts = [];
  if (m) {
    parts.push(
      `Stryker вніс у код ${num(m.valid)} ${plural(m.valid, ['навмисну помилку', 'навмисні помилки', 'навмисних помилок'])} — по одній за раз — і щоразу запускав тести. ` +
        `Мутант «убитий», якщо хоч один тест через нього впав. Mutation score ${num(pct(m.score))} при порозі ${num(`${m.thresholds.break ?? m.thresholds.low}\u202f%`)}.`,
    );
  }
  if (t && t.specLinked > 0) {
    parts.push(
      `${num(t.specLinked)} ${plural(t.specLinked, ['тест прямо посилається', 'тести прямо посилаються', 'тестів прямо посилаються'])} на розділи spec.`,
    );
  }
  return parts.map((p) => `<p>${p}</p>`).join('');
}

function scale(m) {
  const brk = m.thresholds.break ?? m.thresholds.low;
  const high = m.thresholds.high;
  const s = Math.max(0, Math.min(100, m.score));
  return `
  <figure class="scale">
    <div class="scale-score" style="--s:${s}%">${num(pct(m.score))}</div>
    <div class="track" role="img" aria-label="Mutation score ${esc(pct(m.score))}; збірка падає нижче ${brk} %, ціль від ${high} %">
      <span class="zone below" style="width:${brk}%"></span>
      <span class="zone mid" style="left:${brk}%;width:${high - brk}%"></span>
      <span class="zone good" style="left:${high}%;width:${100 - high}%"></span>
      <span class="fill" style="width:${s}%"></span>
      <span class="tick" style="left:${brk}%"></span>
      <span class="tick" style="left:${high}%"></span>
    </div>
    <div class="scale-labels" aria-hidden="true">
      <span style="left:0">${num('0')}</span>
      <span style="left:${brk}%">${num(brk)}</span>
      <span style="left:${high}%">${num(high)}</span>
    </div>
    <figcaption>Збірка падає, якщо score нижче ${num(`${brk}\u202f%`)}. Ціль — від ${num(`${high}\u202f%`)}.</figcaption>
  </figure>`;
}

function field(m) {
  let i = 0;
  const total = m.files.reduce((a, f) => a + f.mutants.length, 0);
  const step = Math.min(2.2, 1400 / Math.max(total, 1)); // уся анімація ≤ ~1.4 с
  const rows = m.files
    .map((f) => {
      const cells = f.mutants
        .map((mu) => {
          const st = STATUS[mu.status] ?? STATUS.Ignored;
          const delay = (i++ * step).toFixed(0);
          return `<i class="c ${st.cls}" style="--d:${delay}ms" title="${esc(`${f.path}:${mu.location.start.line} ${mu.mutatorName} — ${st.label}`)}"></i>`;
        })
        .join('');
      return `<div class="frow"><span class="fname">${esc(f.path.replace(/^src\//, ''))}</span><span class="cells">${cells}</span></div>`;
    })
    .join('');
  const legend = [
    ['killed', 'убито', m.killed],
    ['timeout', 'таймаут', m.timeout],
    ['survived', 'вижило', m.survived],
    ['nocov', 'без покриття', m.noCoverage],
    ['ignored', 'пропущено', m.ignored],
  ]
    .filter(([cls, , n]) => n > 0 || cls === 'survived')
    .map(([cls, label, n]) => `<li><i class="c ${cls}"></i>${label} ${num(n)}</li>`)
    .join('');
  return `
  <section class="field" aria-labelledby="field-h">
    <h2 id="field-h">Кожна клітинка — один мутант</h2>
    <ul class="legend">${legend}</ul>
    <div class="grid" aria-hidden="true">${rows}</div>
  </section>`;
}

function diff(mu) {
  const { start, end } = mu.location;
  const line = mu.line;
  if (start.line === end.line) {
    const a = line.slice(0, start.column - 1);
    const b = line.slice(start.column - 1, end.column - 1);
    const c = line.slice(end.column - 1);
    const lead = a.length - a.trimStart().length;
    return `<code class="diff">${esc(a.slice(lead))}<del>${esc(b)}</del><ins>${esc(mu.replacement ?? '')}</ins>${esc(c)}</code>`;
  }
  return `<code class="diff"><del>${esc(line.trim())} …</del><ins>${esc((mu.replacement ?? '').split('\n')[0])} …</ins></code>`;
}

function killer(mu, names) {
  const id = mu.killedBy?.[0];
  if (!id) return mu.statusReason ? esc(mu.statusReason) : '';
  const name = names.get(id) ?? '';
  const short = name.split(' > ').slice(-1)[0];
  const more = (mu.killedBy?.length ?? 1) - 1;
  return `<span title="${esc(name)}">${esc(short)}</span>${more > 0 ? ` <span class="more">+${num(more)}</span>` : ''}`;
}

function mutantTable(f, names, onlyAlive = false) {
  const rows = f.mutants
    .filter((mu) => !onlyAlive || mu.status === 'Survived' || mu.status === 'NoCoverage')
    .map((mu) => {
      const st = STATUS[mu.status] ?? STATUS.Ignored;
      return `<tr class="${st.cls}">
        <td class="ln">${num(mu.location.start.line)}</td>
        <td>${diff(mu)}</td>
        <td class="mut">${esc(mu.mutatorName)}</td>
        <td class="st"><i class="c ${st.cls}"></i>${st.label}</td>
        <td class="by">${killer(mu, names)}</td>
      </tr>`;
    })
    .join('');
  return `<table class="mutants">
    <thead><tr><th>Рядок</th><th>Зміна</th><th>Мутатор</th><th>Результат</th><th>Що впіймало</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function toFix(m) {
  const alive = m.files.filter((f) => f.survived + f.noCoverage > 0);
  if (alive.length === 0) {
    return `
    <section class="tofix calm" aria-labelledby="fix-h">
      <h2 id="fix-h">Виправляти нічого</h2>
      <p>Кожна зміна в коді ламає хоча б один тест. Якщо мутант колись виживе, він з’явиться тут разом із рядком коду і зміною, яку тести не помітили.</p>
    </section>`;
  }
  return `
  <section class="tofix" aria-labelledby="fix-h">
    <h2 id="fix-h">Що виправити</h2>
    <p>Ці зміни в коді не помітив жоден тест. Додайте тест, який падає через таку зміну, або спростіть код, якщо зміна нічого не міняє в поведінці.</p>
    ${alive.map((f) => `<h3 class="path">${esc(f.path)}</h3>${mutantTable(f, m.testNames, true)}`).join('')}
  </section>`;
}

function testsSection(t) {
  const cols = LEVELS.map(([k, title, desc]) => {
    const l = t.byLevel[k];
    const failed = l.failed > 0 ? `<span class="bad">${num(l.failed)} падає</span>` : '';
    const skipped = l.skipped > 0 ? `<span class="muted">${num(l.skipped)} пропущено</span>` : '';
    return `<div class="level"><h3>${title}</h3><p class="big">${num(l.passed)}</p><p class="desc">${desc}</p><p class="extra">${failed}${skipped}</p></div>`;
  }).join('');
  const failures =
    t.failures.length > 0
      ? `<ul class="failures">${t.failures.map((f) => `<li><code>${esc(f.file)}</code> ${esc(f.name)}</li>`).join('')}</ul>`
      : '';
  return `
  <section class="tests" aria-labelledby="tests-h">
    <h2 id="tests-h">Тести</h2>
    <div class="levels">${cols}</div>
    ${failures}
  </section>`;
}

function coverageSection(c) {
  const metric = (key, label) => {
    const v = c.total[key];
    return `<div class="metric"><span class="label">${label}</span><span class="bar"><span style="width:${v.pct}%"></span></span><span class="val">${num(pct(v.pct))}</span><span class="frac">${num(`${v.covered}/${v.total}`)}</span></div>`;
  };
  const weakest = Object.entries(c)
    .filter(([k]) => k !== 'total')
    .map(([k, v]) => ({ path: relative(root, k), pct: v.lines.pct }))
    .filter((f) => f.pct < 100)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 4);
  const weak =
    weakest.length > 0
      ? `<p class="note">Найменше покриті: ${weakest.map((f) => `<code>${esc(f.path)}</code> ${num(pct(f.pct))}`).join(', ')}.</p>`
      : '';
  return `
  <section class="coverage" aria-labelledby="cov-h">
    <h2 id="cov-h">Покриття коду</h2>
    <p class="hint">Яку частину коду виконують тести. Мутаційне тестування вище показує, чи тести ще й перевіряють результат.</p>
    <div class="metrics">
      ${metric('lines', 'Рядки')}${metric('statements', 'Інструкції')}${metric('branches', 'Розгалуження')}${metric('functions', 'Функції')}
    </div>
    ${weak}
  </section>`;
}

function filesSection(m) {
  const rows = m.files
    .map(
      (f) => `
    <details class="file">
      <summary>
        <span class="path">${esc(f.path)}</span>
        <span class="num">${num(f.valid)}</span>
        <span class="num">${num(f.killed + f.timeout)}</span>
        <span class="num ${f.survived + f.noCoverage > 0 ? 'bad' : 'zero'}">${num(f.survived + f.noCoverage)}</span>
        <span class="bar"><span style="width:${f.score}%"></span></span>
        <span class="num score">${num(pct(f.score))}</span>
      </summary>
      ${mutantTable(f, m.testNames)}
    </details>`,
    )
    .join('');
  return `
  <section class="files" aria-labelledby="files-h">
    <h2 id="files-h">Мутації за файлами</h2>
    <p class="hint">Розгорніть файл, щоб побачити кожну зміну і тест, який її впіймав.</p>
    <div class="fhead" aria-hidden="true"><span>Файл</span><span>Мутантів</span><span>Убито</span><span>Вижило</span><span></span><span>Score</span></div>
    ${rows}
  </section>`;
}

function sqlSection(s) {
  const killed = s.results.filter((r) => r.killed).length;
  const rows = s.results
    .map(
      (r) => `<tr class="${r.killed ? 'killed' : 'survived'}">
      <td class="path">${esc(r.file.replace(/^src\//, ''))}</td>
      <td><code class="diff"><del>${esc(r.from)}</del><ins>${esc(r.to)}</ins></code></td>
      <td class="st"><i class="c ${r.killed ? 'killed' : 'survived'}"></i>${r.killed ? 'убито' : 'вижив'}</td>
    </tr>`,
    )
    .join('');
  return `
  <section class="sql" aria-labelledby="sql-h">
    <h2 id="sql-h">Умови в SQL</h2>
    <p class="hint">Stryker не змінює текст SQL-запитів, тому кожну бізнес-умову перевірено окремо: її прибирають, і інтеграційні тести мають упасти. Убито ${num(killed)} із ${num(s.results.length)}.</p>
    <table class="mutants sqlt"><thead><tr><th>Файл</th><th>Зміна</th><th>Результат</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ---------- page ----------

const t = summarizeTests();
const m = summarizeMutation();
const commit = git('rev-parse --short HEAD');
const branch = git('rev-parse --abbrev-ref HEAD');
const now = new Date();
const date = new Intl.DateTimeFormat('uk-UA', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Kyiv',
}).format(now);

const css = `
${fonts}
:root{
  --tide:#0F2B33; --tide-deep:#0A1F25; --tide-raised:#143A44; --tide-glow:#1D4D57;
  --paper:#E6EEEA; --muted:#8FA8A6; --hair:rgba(230,238,234,.12); --hair-strong:rgba(230,238,234,.22);
  --brass:#D9B45A; --brass-soft:#B8975094; --sage:#6FB7A4; --cinnabar:#E2574C; --slate:#5E7A7D;
  --serif:'Spectral',Georgia,'Times New Roman',serif; --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{background:var(--tide-deep)}
body{
  margin:0; color:var(--paper); font:400 1.0625rem/1.65 var(--serif);
  background:
    radial-gradient(1100px 620px at 8% -8%, var(--tide-glow) 0%, transparent 62%),
    radial-gradient(900px 520px at 105% 18%, #12404A 0%, transparent 60%),
    linear-gradient(180deg, var(--tide) 0%, var(--tide-deep) 100%);
  background-attachment:fixed; min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.n{font-family:var(--mono); font-variant-ligatures:none; font-variant-numeric:tabular-nums; font-weight:400; letter-spacing:-.01em}
code{font-family:var(--mono); font-size:.82em; font-variant-ligatures:none}
main{max-width:1120px; margin:0 auto; padding:56px 40px 96px}
header.top{display:flex; justify-content:space-between; align-items:baseline; gap:24px; color:var(--muted); font-size:.95rem; border-bottom:1px solid var(--hair); padding-bottom:18px}
header.top .proj{color:var(--paper); font-weight:500; letter-spacing:.01em}
header.top .meta{text-align:right}
.hero{padding:72px 0 48px; max-width:900px}
.hero h1{font-weight:300; font-size:clamp(2.2rem, 4.6vw, 3.6rem); line-height:1.08; letter-spacing:-.015em; margin:0 0 28px}
.hero h1 .n{font-size:.8em; font-weight:400; letter-spacing:-.03em}
.hero p{color:var(--muted); max-width:64ch; margin:0 0 10px}
.hero p .n{color:var(--paper)}
.scale{margin:40px 0 0; max-width:760px}
.track{position:relative; height:10px; border-radius:5px; background:rgba(230,238,234,.06); overflow:hidden}
.zone{position:absolute; top:0; bottom:0}
.zone.below{left:0; background:rgba(226,87,76,.10)}
.zone.mid{background:rgba(217,180,90,.10)}
.zone.good{background:rgba(111,183,164,.12)}
.fill{position:absolute; left:0; top:3px; bottom:3px; border-radius:3px; background:linear-gradient(90deg, rgba(111,183,164,.55), var(--brass)); animation:grow 1.2s cubic-bezier(.2,.7,.2,1) both}
.tick{position:absolute; top:-2px; bottom:-2px; width:1px; background:var(--hair-strong)}
.scale-score{position:relative; height:1.6em; margin-bottom:8px; color:var(--brass); font-size:1.05rem}
.scale-score .n{position:absolute; left:var(--s); transform:translateX(-100%); white-space:nowrap}
.scale-labels{position:relative; height:22px; margin-top:8px; font-size:.78rem; color:var(--muted)}
.scale-labels span{position:absolute; transform:translateX(-50%)}
.scale-labels span:first-child{transform:none}
.scale figcaption{color:var(--muted); font-size:.92rem; margin-top:6px}
.scale figcaption .n{color:var(--paper)}
section{padding:56px 0 0}
h2{font-weight:400; font-size:1.65rem; line-height:1.25; letter-spacing:-.01em; margin:0 0 8px}
h3{font-weight:500; font-size:1.05rem; margin:0}
.hint{color:var(--muted); margin:0 0 22px; max-width:68ch}
.field{border-top:1px solid var(--hair); margin-top:8px}
.legend{list-style:none; display:flex; flex-wrap:wrap; gap:6px 22px; padding:0; margin:10px 0 24px; color:var(--muted); font-size:.92rem}
.legend li{display:flex; align-items:center; gap:8px}
.legend .n{color:var(--paper)}
.grid{display:flex; flex-direction:column; gap:7px}
.frow{display:grid; grid-template-columns:340px 1fr; gap:18px; align-items:start}
.fname{font-family:var(--mono); font-variant-ligatures:none; font-size:.74rem; color:var(--muted); line-height:12px; padding-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.cells{display:flex; flex-wrap:wrap; gap:3px}
.c{display:inline-block; width:11px; height:11px; border-radius:2.5px; flex:none}
.cells .c{animation:pop .5s ease-out both; animation-delay:var(--d)}
.c.killed{background:var(--sage)}
.c.timeout{background:var(--brass)}
.c.survived{background:var(--cinnabar); box-shadow:0 0 0 2px rgba(226,87,76,.25)}
.c.nocov{background:transparent; box-shadow:inset 0 0 0 1.5px var(--cinnabar)}
.c.ignored{background:transparent; box-shadow:inset 0 0 0 1.5px var(--slate)}
.tofix{border-top:1px solid var(--hair); margin-top:48px}
.tofix p{max-width:68ch; color:var(--muted)}
.tofix .path{font-family:var(--mono); font-size:.85rem; font-weight:400; margin:26px 0 8px; color:var(--paper)}
.tofix.calm h2{color:var(--sage)}
.levels{display:grid; grid-template-columns:repeat(3,1fr); border-top:1px solid var(--hair); border-bottom:1px solid var(--hair)}
.level{padding:22px 24px 20px 0}
.level + .level{padding-left:24px; border-left:1px solid var(--hair)}
.level .big{margin:6px 0 2px; font-size:2.6rem; line-height:1.1}
.level .big .n{font-weight:400; letter-spacing:-.03em}
.level .desc{margin:0; color:var(--muted); font-size:.95rem; max-width:30ch}
.level .extra{margin:8px 0 0; font-size:.88rem; display:flex; gap:14px}
.bad{color:var(--cinnabar)} .muted{color:var(--muted)}
.failures{margin:18px 0 0; padding-left:18px; color:var(--cinnabar)}
.metrics{display:grid; gap:12px; max-width:760px}
.metric{display:grid; grid-template-columns:150px 1fr 90px 90px; gap:18px; align-items:center}
.metric .label{color:var(--paper)}
.metric .val{text-align:right}
.metric .frac{text-align:right; color:var(--muted); font-size:.85rem}
.bar{display:block; height:6px; border-radius:3px; background:rgba(230,238,234,.07); overflow:hidden}
.bar > span{display:block; height:100%; border-radius:3px; background:linear-gradient(90deg, rgba(111,183,164,.45), var(--sage))}
.note{color:var(--muted); font-size:.95rem; margin-top:20px; max-width:80ch}
.note .n{color:var(--paper)}
.fhead, .file summary{display:grid; grid-template-columns:minmax(0,1fr) 84px 70px 70px 160px 96px; gap:16px; align-items:center}
.fhead{color:var(--muted); font-size:.85rem; padding:0 14px 10px; border-bottom:1px solid var(--hair-strong)}
.fhead span:nth-child(n+2){text-align:right}
.file{border-bottom:1px solid var(--hair)}
.file summary{list-style:none; cursor:pointer; padding:11px 14px; border-radius:6px}
.file summary::-webkit-details-marker{display:none}
.file summary:hover{background:rgba(230,238,234,.035)}
.file summary:focus-visible{outline:2px solid var(--brass); outline-offset:2px}
.file[open] summary{background:rgba(230,238,234,.05)}
.file .path{font-family:var(--mono); font-size:.84rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.file .path::before{content:''; display:inline-block; width:6px; height:6px; margin-right:12px; border-right:1.5px solid var(--muted); border-bottom:1.5px solid var(--muted); transform:rotate(-45deg) translateY(-2px); transition:transform .2s}
.file[open] .path::before{transform:rotate(45deg) translateY(-3px)}
.num{text-align:right}
.num.zero{color:var(--muted)}
.num.score{color:var(--paper)}
table.mutants{width:100%; border-collapse:collapse; margin:6px 0 18px; font-size:.86rem}
table.mutants th{text-align:left; font-weight:400; color:var(--muted); padding:10px 12px; border-bottom:1px solid var(--hair)}
table.mutants td{padding:8px 12px; vertical-align:top; border-bottom:1px solid rgba(230,238,234,.05)}
table.mutants .ln{text-align:right; color:var(--muted); width:56px}
table.mutants .mut{color:var(--muted); font-family:var(--mono); font-size:.76rem; white-space:nowrap}
table.mutants .st{white-space:nowrap} table.mutants .st .c{margin-right:8px; vertical-align:-1px}
table.mutants .by{color:var(--muted); max-width:300px}
table.mutants .more{color:var(--slate)}
table.mutants .path{font-family:var(--mono); font-size:.78rem; color:var(--muted); white-space:nowrap}
tr.survived td, tr.nocov td{background:rgba(226,87,76,.06)}
.diff{white-space:pre-wrap; word-break:break-word; color:var(--muted)}
.diff del{text-decoration:line-through; text-decoration-color:rgba(226,87,76,.8); color:#E8A39C; background:rgba(226,87,76,.10); border-radius:2px; padding:0 2px}
.diff ins{text-decoration:none; color:var(--paper); background:rgba(111,183,164,.16); border-radius:2px; padding:0 2px; margin-left:3px}
footer{margin-top:80px; padding-top:20px; border-top:1px solid var(--hair); color:var(--muted); font-size:.92rem; display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap}
footer code{color:var(--paper)}
@keyframes pop{from{opacity:0; transform:scale(.4)} to{opacity:1; transform:none}}
@keyframes grow{from{width:0}}
@media (prefers-reduced-motion: reduce){.cells .c,.fill{animation:none}}
@media (max-width:860px){
  main{padding:32px 20px 64px}
  header.top{flex-direction:column; gap:4px} header.top .meta{text-align:left}
  .hero{padding-top:44px}
  .frow{grid-template-columns:1fr; gap:6px}
  .levels{grid-template-columns:1fr} .level + .level{padding-left:0; border-left:0; border-top:1px solid var(--hair)}
  .metric{grid-template-columns:110px 1fr 76px}
  .metric .frac{display:none}
  .fhead{display:none}
  .file summary{grid-template-columns:minmax(0,1fr) 84px; row-gap:4px}
  .file summary .num:not(.score), .file summary .bar{display:none}
  table.mutants .mut, table.mutants .by{display:none}
}
@media print{body{background:var(--tide)} .cells .c,.fill{animation:none} details.file{break-inside:avoid}}
`;

const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CBT Journal — звіт якості</title>
<style>${css}</style>
</head>
<body>
<main>
  <header class="top">
    <span class="proj">CBT Journal <span class="muted">/ звіт якості</span></span>
    <span class="meta">${esc(date)}${commit ? `, коміт ${num(commit)}` : ''}${branch && branch !== 'HEAD' ? ` у <code>${esc(branch)}</code>` : ''}</span>
  </header>

  <section class="hero" aria-labelledby="verdict">
    <h1 id="verdict">${verdict(t, m)}</h1>
    ${lede(t, m)}
    ${m ? scale(m) : ''}
  </section>

  ${m ? field(m) : ''}
  ${m ? toFix(m) : ''}
  ${t ? testsSection(t) : ''}
  ${coverage ? coverageSection(coverage) : ''}
  ${m ? filesSection(m) : ''}
  ${sql ? sqlSection(sql) : ''}

  <footer>
    <span>Оновити звіт: <code>make report</code></span>
    <span>Джерела: Vitest, V8 coverage, Stryker, <code>scripts/sql-mutation.sh</code></span>
  </footer>
</main>
</body>
</html>
`;

writeFileSync(at('reports/index.html'), html);
process.stdout.write(`quality report: ${relative(process.cwd(), at('reports/index.html'))}\n`);
