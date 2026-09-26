import 'dotenv/config';

const required = [
  'GROQ_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'COHERE_API_KEY',
  'TAVILY_API_KEY',
  'JWT_SECRET',
  'INTERNAL_API_SECRET',
  'CODE_RUNNER_SECRET',
  'CODE_RUNNER_NODE_URL',
  'CODE_RUNNER_PYTHON_URL',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key} (see server/.env.example)`);
  }
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  groqApiKey: process.env.GROQ_API_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
  cohereApiKey: process.env.COHERE_API_KEY,
  tavilyApiKey: process.env.TAVILY_API_KEY,
  jwtSecret: process.env.JWT_SECRET,
  internalApiSecret: process.env.INTERNAL_API_SECRET,
  codeRunnerSecret: process.env.CODE_RUNNER_SECRET,
  codeRunnerNodeUrl: process.env.CODE_RUNNER_NODE_URL,
  codeRunnerPythonUrl: process.env.CODE_RUNNER_PYTHON_URL,
  // Optional: GitHub integration for the dev agent. Absent = tools disabled,
  // not a boot failure — this isn't core to the app running.
  githubToken: process.env.GITHUB_TOKEN || null,
  githubAllowedRepos: (process.env.GITHUB_ALLOWED_REPOS || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean),
  // Optional: Google (Gmail/Drive) connector. Needed here only to refresh an
  // expired access token — the OAuth exchange itself happens in the Lambda.
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
  // The control-plane Lambda's public Function URL — this is the same
  // front-door address the web client itself talks to (not a secret), so a
  // hardcoded default is fine and avoids requiring a matching .env edit on
  // the EC2 box just to enable background-task push notifications.
  controlPlaneUrl: process.env.CONTROL_PLANE_URL || 'https://pdccvynvrn4dltlzbtj6y2ysga0amggp.lambda-url.ap-south-1.on.aws',
};
