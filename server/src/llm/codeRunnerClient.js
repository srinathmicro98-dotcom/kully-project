import { config } from '../config.js';

const URLS = {
  node: config.codeRunnerNodeUrl,
  python: config.codeRunnerPythonUrl,
};

/**
 * Calls the isolated, ephemeral code-runner Lambda for the given language.
 * Never touches the EC2 box — separate function, separate minimal IAM role
 * scoped to just the S3 workspace bucket.
 *
 * `action` selects what the sandbox does with this call: `run` (execute the
 * given code as the entry point — the original/default behavior), `read_file`,
 * `write_file`, `list_files`, or `run_shell` (run an arbitrary shell command
 * instead of a whole program). All actions share the same per-user/per-project
 * S3-backed workspace, so a file written by one action is visible to the next.
 */
export async function callCodeRunner({ language, action = 'run', userId, project, ...rest }) {
  const url = URLS[language];
  if (!url) throw new Error(`unsupported language: ${language}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Code-Runner-Secret': config.codeRunnerSecret,
    },
    body: JSON.stringify({ action, user_id: userId, project: project || 'default', ...rest }),
  });

  if (!res.ok) {
    throw new Error(`code runner returned ${res.status}`);
  }
  return res.json();
}
