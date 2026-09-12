import 'dotenv/config';

const required = [
  'GROQ_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'COHERE_API_KEY',
  'TAVILY_API_KEY',
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
};
