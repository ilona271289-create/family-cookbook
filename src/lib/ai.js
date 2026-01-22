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

  const response = await supabase.functions.invoke('openai-whisper', {
    body: formData
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.data;
}
