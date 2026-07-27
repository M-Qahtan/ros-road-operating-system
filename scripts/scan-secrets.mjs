import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const excluded = [
  /^pnpm-lock\.yaml$/,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)artifacts\//,
  /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|woff2?)$/i,
];

const rules = [
  { name: 'GitHub token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: 'Hard-coded credential assignment',
    pattern: /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]\s*["'](?!\$\{|process\.env|env\.|example|placeholder|change-me|test-only|localhost)[A-Za-z0-9_+\/=.-]{16,}["']/gi,
  },
];

const findings = [];
for (const file of trackedFiles) {
  if (excluded.some((pattern) => pattern.test(file))) continue;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${line}: ${rule.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Potential committed credentials detected:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed for ${trackedFiles.length} tracked files.`);
