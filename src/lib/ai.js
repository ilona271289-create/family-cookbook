import { supabase } from './supabase.js';

export async function callOpenAIChat(messages) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not authenticated');
  }

  const response = await supabase.functions.invoke('openai-chat', {
    body: { messages }
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.data;
}

export async function transcribeAudio(audioFile) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not authenticated');
  }

  const formData = new FormData();
  formData.append('file', audioFile);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const apiUrl = `${supabaseUrl}/functions/v1/openai-whisper`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Transcription failed');
  }

  return await response.json();
}
