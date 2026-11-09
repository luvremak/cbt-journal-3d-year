#!/usr/bin/env bash
# Ручне мутаційне тестування SQL: Stryker не змінює логіку всередині SQL-рядків,
# тому для кожної бізнес-умови з test/sql-mutants.tsv
# (файл <TAB> було <TAB> стало [<TAB> номер входження, за замовчуванням 1])
# підміняємо її, запускаємо інтеграційні + E2E тести і чекаємо, що вони впадуть.
set -uo pipefail
cd "$(dirname "$0")/.."
list=test/sql-mutants.tsv
killed=0; total=0; survived=()
results=$(mktemp)
while IFS=$'\t' read -r file from to nth; do
  [ -z "$file" ] && continue
  total=$((total + 1))
  backup=$(mktemp)
  cp "$file" "$backup"
  node -e '
    const fs = require("fs"); const [p, a, b, n] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    let at = -1;
    for (let k = 0; k < Number(n || 1); k++) {
      at = s.indexOf(a, at + 1);
      if (at < 0) { console.error("pattern #" + (k + 1) + " not found in " + p + ": " + a); process.exit(2); }
    }
    fs.writeFileSync(p, s.slice(0, at) + b + s.slice(at + a.length));
  ' "$file" "$from" "$to" "${nth:-1}" || { cp "$backup" "$file"; rm -f "$backup"; exit 2; }
  if npx vitest run test/integration test/e2e >/dev/null 2>&1; then
    survived+=("$file: $from #${nth:-1}")
    printf '%s\t%s\t%s\t0\n' "$file" "$from" "$to" >> "$results"
    echo "SURVIVED  $file: $from -> $to #${nth:-1}"
  else
    killed=$((killed + 1))
    printf '%s\t%s\t%s\t1\n' "$file" "$from" "$to" >> "$results"
    echo "killed    $file: $from -> $to #${nth:-1}"
  fi
  cp "$backup" "$file"; rm -f "$backup"
done < "$list"
mkdir -p reports
node -e '
  const fs = require("fs");
  const results = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => {
    const [file, from, to, k] = l.split("\t");
    return { file, from, to, killed: k === "1" };
  });
  fs.writeFileSync("reports/sql-mutation.json", JSON.stringify({ results }, null, 2));
' "$results"
rm -f "$results"
echo "SQL mutants killed: $killed/$total"
[ ${#survived[@]} -eq 0 ]
