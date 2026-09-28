/**
 * Looks for leaked credentials in source text.
 * Test files are skipped. Matches are paths only, never the secret text.
 */

const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
  /\bsk-[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export function findSecretLeaks(files) {
  const hits = [];
  for (const file of files) {
    if (file.path.includes(".test.") || file.path.endsWith(".md")) continue;
    if (PATTERNS.some((pattern) => pattern.test(file.text))) hits.push(file.path);
  }
  return hits;
}
