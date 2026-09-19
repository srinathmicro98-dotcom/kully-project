import { Router } from 'express';
import { transcribeAudio, textToSpeech } from '../llm/groqClient.js';
import { logger } from '../utils/logger.js';

export const voiceRouter = Router();

voiceRouter.post('/voice/transcribe', async (req, res) => {
  const { audio_base64: audioBase64, mime_type: mimeType } = req.body ?? {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'audio_base64 is required' });
  }
  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const ext = typeof mimeType === 'string' && mimeType.includes('/') ? mimeType.split('/')[1].split(';')[0] : 'webm';
    const text = await transcribeAudio(buffer, `audio.${ext}`);
    res.json({ text });
  } catch (err) {
    logger.error('transcription failed:', err);
    res.status(500).json({ error: 'transcription failed' });
  }
});

voiceRouter.post('/voice/speak', async (req, res) => {
  const { text } = req.body ?? {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const audio = await textToSpeech(text);
    res.set('Content-Type', 'audio/wav');
    res.send(audio);
  } catch (err) {
    logger.error('text-to-speech failed:', err);
    res.status(500).json({ error: 'text-to-speech failed' });
  }
});
