#!/usr/bin/env bash
# Ручне мутаційне тестування SQL: Stryker не змінює логіку всередині SQL-рядків,
# тому для кожної бізнес-умови з test/sql-mutants.tsv (файл <TAB> було <TAB> стало)
# підміняємо її, запускаємо інтеграційні + E2E тести і чекаємо, що вони впадуть.
set -uo pipefail
cd "$(dirname "$0")/.."
list=test/sql-mutants.tsv
killed=0; total=0; survived=()
while IFS=$'\t' read -r file from to; do
  [ -z "$file" ] && continue
  total=$((total + 1))
  backup=$(mktemp)
  cp "$file" "$backup"
  node -e '
    const fs = require("fs"); const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) { console.error("pattern not found in " + p + ": " + a); process.exit(2); }
    fs.writeFileSync(p, s.replace(a, b));
  ' "$file" "$from" "$to" || { cp "$backup" "$file"; rm -f "$backup"; exit 2; }
  if npx vitest run test/integration test/e2e >/dev/null 2>&1; then
    survived+=("$file: $from")
    echo "SURVIVED  $file: $from"
  else
    killed=$((killed + 1))
    echo "killed    $file: $from"
  fi
  cp "$backup" "$file"; rm -f "$backup"
done < "$list"
echo "SQL mutants killed: $killed/$total"
[ ${#survived[@]} -eq 0 ]
