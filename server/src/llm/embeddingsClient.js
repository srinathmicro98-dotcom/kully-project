import { config } from '../config.js';

const COHERE_EMBED_URL = 'https://api.cohere.com/v2/embed';

/**
 * @param {string[]} texts
 * @param {'search_document'|'search_query'} inputType
 * @returns {Promise<number[][]>}
 */
export async function embed(texts, inputType = 'search_document') {
  const res = await fetch(COHERE_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cohereApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'embed-english-v3.0',
      texts,
      input_type: inputType,
      embedding_types: ['float'],
    }),
  });

  if (!res.ok) {
    throw new Error(`Cohere embed failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.embeddings.float;
}

export async function embedOne(text, inputType = 'search_document') {
  const [vector] = await embed([text], inputType);
  return vector;
}
