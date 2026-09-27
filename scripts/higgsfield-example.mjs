#!/usr/bin/env node
// Standalone proof-of-concept for the Higgsfield/Seedance 2.5 integration
// (server/src/llm/higgsfieldClient.js). Submits ONE real generation job —
// this is a billable request against a real account, not a mock — and
// prints the resulting video URL, or reports exactly why it didn't succeed.
//
// Usage: node scripts/higgsfield-example.mjs
// Reads HF_CREDENTIALS from server/.env.local (gitignored).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal inline .env.local loader — avoids adding a dotenv dependency to
// scripts/ for a single variable.
const envLocalPath = path.join(__dirname, '../server/.env.local');
for (const line of readFileSync(envLocalPath, 'utf8').split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] ??= match[2].trim();
}

const { generateVideo } = await import('../server/src/llm/higgsfieldClient.js');

async function main() {
  console.log('Submitting a real Higgsfield (Seedance 2.5) generation job — this is billable...');
  try {
    const { url } = await generateVideo({
      prompt: 'A cinematic scene at sunset',
      duration: 5,
      resolution: '720p',
      aspectRatio: '16:9',
    });
    console.log('SUCCESS — generated video URL:');
    console.log(url);
  } catch (err) {
    console.error('Video generation did NOT succeed:', err.message);
    process.exitCode = 1;
  }
}

main();
