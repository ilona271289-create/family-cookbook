import { supabase } from './supabase.js';

export async function callOpenAIChat(messages) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const openaiKey = import.meta.env.OPENAI_API_KEY;
  const apiUrl = `${supabaseUrl}/functions/v1/openai-chat`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ messages, apiKey: openaiKey })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Chat API failed');
  }

  return await response.json();
}

export async function transcribeAudio(audioFile) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const apiUrl = `${supabaseUrl}/functions/v1/openai-whisper`;

  const formData = new FormData();
  formData.append('file', audioFile);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Transcription failed');
  }

  return await response.json();
}
