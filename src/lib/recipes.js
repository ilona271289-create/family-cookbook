import { supabase } from './supabase.js';

export async function getRecipes() {
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function addRecipe(recipe) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('recipes')
    .insert([{
      user_id: user.id,
      title: recipe.title || 'Без названия',
      category: recipe.category || '',
      servings: recipe.servings || '',
      time: recipe.time || '',
      ingredients: recipe.ingredients || '',
      steps: recipe.steps || '',
      notes: recipe.notes || '',
      tags: recipe.tags || [],
      is_favorite: false
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateRecipe(id, updates) {
  const { error } = await supabase
    .from('recipes')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteRecipe(id) {
  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function toggleFavorite(id, currentFav) {
  await updateRecipe(id, { is_favorite: !currentFav });
}

export function subscribeToRecipes(callback) {
  return supabase
    .channel('recipes_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'recipes' },
      callback
    )
    .subscribe();
}
