/*
  # Создание таблицы рецептов для семейной книги El Pablo

  1. Новые таблицы
    - `recipes` - хранение рецептов
      - `id` (uuid, primary key)
      - `user_id` (uuid, ссылка на auth.users) - автор рецепта
      - `title` (text) - название блюда
      - `category` (text) - категория (завтрак, суп, десерт и т.д.)
      - `servings` (text) - количество порций
      - `time` (text) - время приготовления
      - `ingredients` (text) - ингредиенты (каждый с новой строки)
      - `steps` (text) - шаги приготовления (каждый с новой строки)
      - `notes` (text) - заметки и советы
      - `tags` (text[]) - массив тегов
      - `is_favorite` (boolean) - избранный рецепт (для текущего пользователя)
      - `created_at` (timestamptz) - дата создания
      - `updated_at` (timestamptz) - дата последнего обновления

  2. Безопасность
    - Включен Row Level Security (RLS)
    - Политики:
      - Пользователи могут читать все рецепты (семейная книга)
      - Пользователи могут создавать свои рецепты
      - Пользователи могут редактировать свои рецепты
      - Пользователи могут удалять свои рецепты

  3. Важные заметки
    - Используем auth.uid() для проверки владельца
    - Все рецепты видны всем авторизованным пользователям (семейная книга)
    - Каждый может редактировать только свои рецепты
*/

-- Создаем таблицу рецептов
CREATE TABLE IF NOT EXISTS recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL DEFAULT '',
  category text DEFAULT '',
  servings text DEFAULT '',
  time text DEFAULT '',
  ingredients text DEFAULT '',
  steps text DEFAULT '',
  notes text DEFAULT '',
  tags text[] DEFAULT '{}',
  is_favorite boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Создаем индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
CREATE INDEX IF NOT EXISTS idx_recipes_is_favorite ON recipes(is_favorite);
CREATE INDEX IF NOT EXISTS idx_recipes_created_at ON recipes(created_at DESC);

-- Включаем Row Level Security
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- Политика: все авторизованные пользователи могут читать все рецепты
CREATE POLICY "Anyone can view recipes"
  ON recipes
  FOR SELECT
  TO authenticated
  USING (true);

-- Политика: пользователи могут создавать свои рецепты
CREATE POLICY "Users can create own recipes"
  ON recipes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Политика: пользователи могут обновлять свои рецепты
CREATE POLICY "Users can update own recipes"
  ON recipes
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Политика: пользователи могут удалять свои рецепты
CREATE POLICY "Users can delete own recipes"
  ON recipes
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Создаем функцию для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Создаем триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_recipes_updated_at ON recipes;
CREATE TRIGGER update_recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
