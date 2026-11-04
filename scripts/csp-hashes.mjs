import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Astro inlines its island loader. Hash those blocks so script-src can stay strict. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.html')) out.push(path);
  }
  return out;
}

function digest(body) {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

for (const file of walk('dist')) {
  let html = readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => digest(match[1]));
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => digest(match[1]));
  html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (_all, open, policy, close) => {
    let next = policy;
    if (scripts.length) next = next.replace("script-src 'self'", `script-src 'self' ${scripts.join(' ')}`);
    if (styles.length) next = next.replace("style-src 'self'", `style-src 'self' ${styles.join(' ')}`);
    return `${open}${next}${close}`;
  });
  writeFileSync(file, html);
}
