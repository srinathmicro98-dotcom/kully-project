import { config } from '../config.js';

const URLS = {
  node: config.codeRunnerNodeUrl,
  python: config.codeRunnerPythonUrl,
};

/**
 * Executes a snippet in the isolated, ephemeral code-runner Lambda for the
 * given language. Never touches this box — separate function, separate
 * minimal IAM role scoped to just the S3 workspace bucket.
 */
export async function runCode({ language, code, userId }) {
  const url = URLS[language];
  if (!url) throw new Error(`unsupported language: ${language}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Code-Runner-Secret': config.codeRunnerSecret,
    },
    body: JSON.stringify({ code, user_id: userId }),
  });

  if (!res.ok) {
    throw new Error(`code runner returned ${res.status}`);
  }
  return res.json();
}
