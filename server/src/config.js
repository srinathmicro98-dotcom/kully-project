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
};
