import { readFileSync } from 'node:fs';

/**
 * Версія з package.json. Шлях однаковий для src/ (tsx) і dist/ (node):
 * обидва лежать на один рівень нижче кореня репозиторію.
 */
export function readPackageVersion(url = new URL('../package.json', import.meta.url)): string {
  const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}
