/*
  # Add unique constraint on recipe titles
  
  1. Changes
    - Add unique index on recipes.title column to prevent duplicate recipe titles
  
  2. Notes
    - This ensures that each recipe title can only appear once in the database
    - Prevents accidental duplicate imports
*/

CREATE UNIQUE INDEX IF NOT EXISTS recipes_title_unique ON recipes(title);