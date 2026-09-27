// Higgsfield API client for real video generation. Until now the video
// agent's "generate the actual video" step was a deliberate honest stub
// (youtubeUploadVideo in googleClient.js) since no video-gen provider was
// configured — every viable one is paid. This wires up one: Higgsfield's
// Seedance 2.5 text-to-video model, via their official v2 SDK.
//
// Auth: HF_CREDENTIALS env var, "key-id:key-secret" format, loaded from
// server/.env.local (gitignored — never commit this file or its value).
import { config, higgsfield } from '@higgsfield/client/v2';

config({ credentials: process.env.HF_CREDENTIALS });

const SEEDANCE_MODEL = 'bytedance/seedance-2.5/text-to-video';

/**
 * Generates a video from a text prompt via Higgsfield's Seedance 2.5 model.
 * Blocks until the job finishes (the SDK's `withPolling` handles polling).
 * Throws — rather than returning a fabricated success — on any non-completed
 * status (failed, canceled, moderated, or anything else the API returns).
 */
export async function generateVideo({
  prompt,
  duration = 5,
  resolution = '720p',
  aspectRatio = '16:9',
  outputFormat = 'mp4',
  generateAudio = true,
}) {
  const result = await higgsfield.subscribe(SEEDANCE_MODEL, {
    input: {
      prompt,
      duration,
      resolution,
      aspect_ratio: aspectRatio,
      output_format: outputFormat,
      generate_audio: generateAudio,
    },
    withPolling: true,
  });

  if (result.status !== 'completed') {
    throw new Error(`Higgsfield video generation ended with status "${result.status}": ${JSON.stringify(result)}`);
  }

  // Higgsfield's docs describe `images[]` for image models but just "the
  // video field" for this one, without pinning down its exact nesting —
  // check the plausible shapes rather than assume a single path.
  const url = result.video?.url ?? (typeof result.video === 'string' ? result.video : null) ?? result.output?.video?.url;
  if (!url) {
    throw new Error(`Higgsfield returned "completed" but no video URL was found: ${JSON.stringify(result)}`);
  }
  return { url, raw: result };
}
