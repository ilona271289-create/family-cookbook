import { supabase } from './lib/supabase.js';
import { getRecipes, addRecipe, updateRecipe, deleteRecipe, toggleFavorite, subscribeToRecipes } from './lib/recipes.js';
import { callOpenAIChat, transcribeAudio } from './lib/ai.js';
import { importBulkRecipes } from './lib/importRecipes.js';

let recipesCache = [];
let currentSort = 'date-desc';
let messages = [{
  role: 'system',
  content: [
    'Ты — талантливый шеф-повар, который пишет рецепты для НОВИЧКОВ на кухне.',
    '',
    '🎯 ГЛАВНОЕ ПРАВИЛО: В каждом шаге рецепта указывай ТОЧНЫЕ количества продуктов.',
    '',
    'ПРАВИЛЬНО: "Взбей 3 яйца со 180 г сахара и 2 г ванильного сахара до пышности."',
    'НЕПРАВИЛЬНО: "Взбей яйца с сахаром и ванильным сахаром до пышности."',
    '',
    'ПРАВИЛЬНО: "Добавь 200 мл молока и 50 г растопленного сливочного масла."',
    'НЕПРАВИЛЬНО: "Добавь молоко и масло."',
    '',
    '📝 Формат рецепта:',
    '- Каждый шаг — отдельное действие с конкретными количествами',
    '- Указывай температуру духовки, время готовки, размер формы',
    '- Описывай консистенцию ("до густоты сметаны", "до золотистой корочки")',
    '- Предупреждай о важных моментах ("не перемешивай слишком долго", "следи, чтобы не подгорело")',
    '',
    '🎨 Стиль общения:',
    '- Дружелюбный, но чёткий',
    '- Короткие предложения',
    '- Можно лёгкие смайлы 😋🔥',
    '',
    '📏 Единицы измерения:',
    '- Только метрическая система (г, кг, мл, л, °C)',
    '- Порции: 2—6 по умолчанию',
    '- Время: всегда указывай точно (не "около", а "25-30 минут")',
    '',
    '💡 Стратегия:',
    '- Сначала уточни важные детали (аллергии, оборудование)',
    '- Предлагай варианты (быстрее/дешевле/полезнее)',
    '- Объясняй "почему" (почему нужно охладить тесто, зачем просеивать муку)',
    '',
    'Язык: русский',
    'Безопасность: только проверенные техники готовки'
  ].join('\n')
}];

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function autoImportRecipes() {
  const alreadyImported = localStorage.getItem('recipesImported');

  if (!alreadyImported) {
    console.log('Автоматически импортируем рецепты...');
    try {
      await importBulkRecipes();
      localStorage.setItem('recipesImported', 'true');
      console.log('Импорт завершён!');
    } catch (error) {
      console.error('Ошибка автоматического импорта:', error);
    }
  }
}

function setupBulkImport() {
  window.importBulkRecipes = importBulkRecipes;
}


async function loadRecipes() {
  try {
    recipesCache = await getRecipes();
    render();
  } catch (error) {
    console.error('Error loading recipes:', error);
    alert('Ошибка загрузки рецептов: ' + error.message);
  }
}

function handleRecipeChange() {
  loadRecipes();
}

function setupChat() {
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const btnBuild = document.getElementById('btn-build');

  btnSend.onclick = async () => {
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';
    addMsg('user', text);
    messages.push({ role: 'user', content: text });

    try {
      const data = await callOpenAIChat(messages);
      const reply = data.choices?.[0]?.message?.content || '';
      messages.push({ role: 'assistant', content: reply });
      addMsg('assistant', reply);
    } catch (error) {
      console.error('Chat error:', error);
      addMsg('assistant', '❌ Ошибка: ' + error.message);
    }
  };

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      btnSend.click();
    }
  });

  btnBuild.onclick = async () => {
    const ask = [
      'Собери итоговый рецепт по нашей переписке.',
      'ВАЖНО: В массиве steps каждый шаг должен содержать ТОЧНЫЕ количества ингредиентов.',
      'Например: "Взбей 3 яйца со 180 г сахара до пышности" вместо "Взбей яйца с сахаром".',
      '',
      'Верни ТОЛЬКО валидный JSON (без пояснений) со структурой:',
      '{',
      '  "title": "Название блюда",',
      '  "category": "категория",',
      '  "servings": "4",',
      '  "time": "45 мин",',
      '  "ingredients": ["3 яйца", "180 г сахара"],',
      '  "steps": ["Взбей 3 яйца со 180 г сахара до пышности."],',
      '  "notes": "Советы",',
      '  "tags": ["тег1"]',
      '}'
    ].join('\n');

    messages.push({ role: 'user', content: ask });
    addMsg('user', 'Формирую рецепт…');

    try {
      const data = await callOpenAIChat(messages);
      const txt = data.choices?.[0]?.message?.content || '';

      const json = JSON.parse(txt.replace(/```json|```/g, ''));

      await addRecipe({
        title: json.title || 'Без названия',
        category: json.category || '',
        servings: String(json.servings || ''),
        time: json.time || '',
        ingredients: (json.ingredients || []).join('\n'),
        steps: (json.steps || []).join('\n'),
        notes: json.notes || '',
        tags: json.tags || []
      });

      addMsg('assistant', '✅ Рецепт добавлен в каталог!');
      alert('✅ Рецепт добавлен в каталог и синхронизирован!');

    } catch (error) {
      console.error('Build recipe error:', error);
      addMsg('assistant', '❌ Не удалось создать рецепт. Попробуй ещё раз.');
    }
  };
}

function setupManualForm() {
  const form = document.getElementById('manual-recipe-form');
  const btnClear = document.getElementById('btn-clear-manual');

  btnClear.onclick = () => {
    if (confirm('Очистить форму?')) {
      form.reset();
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();

    const title = document.getElementById('manual-title').value.trim();
    const category = document.getElementById('manual-category').value;
    const servings = document.getElementById('manual-servings').value.trim();
    const time = document.getElementById('manual-time').value.trim();
    const ingredients = document.getElementById('manual-ingredients').value.trim();
    const steps = document.getElementById('manual-steps').value.trim();
    const notes = document.getElementById('manual-notes').value.trim();

    if (!title) {
      alert('Укажите название блюда');
      return;
    }

    if (!ingredients) {
      alert('Укажите ингредиенты');
      return;
    }

    if (!steps) {
      alert('Укажите шаги приготовления');
      return;
    }

    try {
      await addRecipe({
        title,
        category,
        servings,
        time,
        ingredients,
        steps,
        notes,
        tags: []
      });

      alert('✅ Рецепт добавлен в каталог!');
      form.reset();
    } catch (error) {
      console.error('Add manual recipe error:', error);
      alert('❌ Ошибка при добавлении рецепта: ' + error.message);
    }
  };
}

function addMsg(role, text) {
  const box = document.getElementById('chat-box');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (role === 'user' ? 'me' : 'ai');
  const b = document.createElement('div');
  b.className = 'b';
  b.innerText = text;
  wrap.append(b);
  box.append(wrap);
  box.scrollTop = box.scrollHeight;
}

function setupVoice() {
  const btnMic = document.getElementById('btn-mic');

  btnMic.onclick = async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];

        let mimeType = 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          mimeType = 'audio/ogg;codecs=opus';
        }

        mediaRecorder = new MediaRecorder(stream, { mimeType });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());

          const blob = new Blob(audioChunks, { type: mimeType });
          let extension = 'webm';
          if (mimeType.includes('mp4')) extension = 'mp4';
          else if (mimeType.includes('ogg')) extension = 'ogg';

          const file = new File([blob], `voice.${extension}`, { type: mimeType });
          addMsg('user', '[Голосовое: распознаю…]');

          try {
            const tr = await transcribeAudio(file);
            const text = tr.text || '';

            if (text) {
              addMsg('user', text);
              messages.push({ role: 'user', content: text });

              const data = await callOpenAIChat(messages);
              const reply = data.choices?.[0]?.message?.content || '';
              messages.push({ role: 'assistant', content: reply });
              addMsg('assistant', reply);
            } else {
              addMsg('assistant', '[Пустой результат распознавания]');
            }
          } catch (error) {
            console.error('Transcription error:', error);
            addMsg('assistant', '[Ошибка распознавания: ' + error.message + ']');
          }
        };

        mediaRecorder.start();
        isRecording = true;
        btnMic.textContent = '■';
        btnMic.style.background = '#dc2626';
        btnMic.style.color = '#fff';
        btnMic.title = 'Остановить запись';
      } catch (error) {
        console.error('Microphone access error:', error);
        alert('Нет доступа к микрофону: ' + error.message);
      }
    } else {
      mediaRecorder?.stop();
      isRecording = false;
      btnMic.textContent = '🎤';
      btnMic.style.background = '';
      btnMic.style.color = '';
      btnMic.title = 'Надиктовать';
    }
  };
}

function setupFilters() {
  document.getElementById('search').oninput = render;
  document.getElementById('filter-category').onchange = render;
  document.getElementById('filter-time').onchange = render;
  document.getElementById('filter-fav').onchange = render;
  document.getElementById('sort-select').onchange = (e) => {
    currentSort = e.target.value;
    render();
  };
  document.getElementById('btn-reset-filters').onclick = () => {
    document.getElementById('search').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-time').value = '';
    document.getElementById('filter-fav').value = 'all';
    document.getElementById('sort-select').value = 'date-desc';
    currentSort = 'date-desc';
    render();
  };
}

function parseTimeInMinutes(timeStr) {
  if (!timeStr) return 999;
  const hoursMatch = timeStr.match(/(\d+)\s*ч/);
  const minsMatch = timeStr.match(/(\d+)\s*мин/);
  let total = 0;
  if (hoursMatch) total += parseInt(hoursMatch[1]) * 60;
  if (minsMatch) total += parseInt(minsMatch[1]);
  return total || 999;
}

function sortRecipes(recipes, sortType) {
  const sorted = [...recipes];
  switch(sortType) {
    case 'date-desc':
      return sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    case 'date-asc':
      return sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    case 'title-asc':
      return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    case 'title-desc':
      return sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    case 'time-asc':
      return sorted.sort((a, b) => parseTimeInMinutes(a.time) - parseTimeInMinutes(b.time));
    case 'time-desc':
      return sorted.sort((a, b) => parseTimeInMinutes(b.time) - parseTimeInMinutes(a.time));
    default:
      return sorted;
  }
}

function render() {
  const root = document.getElementById('cards');
  const counterEl = document.getElementById('recipe-count');
  const q = (document.getElementById('search').value || '').toLowerCase();
  const cat = document.getElementById('filter-category').value;
  const tmax = Number(document.getElementById('filter-time').value || 0);
  const fav = document.getElementById('filter-fav').value;

  const filtered = recipesCache.filter(r => {
    const inQ = !q ||
      (r.title || '').toLowerCase().includes(q) ||
      (r.ingredients || '').toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q);
    const inCat = !cat || (r.category || '') === cat;
    const timeVal = parseTimeInMinutes(r.time);
    const inTime = !tmax || timeVal <= tmax;
    const isFav = r.is_favorite;
    const inFav = fav === 'all' || (fav === 'only' && isFav) || (fav === 'exclude' && !isFav);
    return inQ && inCat && inTime && inFav;
  });

  const sorted = sortRecipes(filtered, currentSort);

  counterEl.textContent = `Найдено: ${sorted.length} из ${recipesCache.length}`;

  root.innerHTML = '';

  if (sorted.length === 0) {
    root.innerHTML = '<div class="empty-state"><div style="font-size:3rem;margin-bottom:1rem">🍽️</div><p>Пока нет рецептов по выбранным фильтрам</p><button class="btn btn-brand" id="temp-reset">Сбросить фильтры</button></div>';
    document.getElementById('temp-reset')?.addEventListener('click', () => {
      document.getElementById('btn-reset-filters').click();
    });
    return;
  }

  sorted.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';

    const row = document.createElement('div');
    row.className = 'title-row';
    const h = document.createElement('div');
    h.className = 'card-title';
    h.textContent = r.title || 'Без названия';
    const star = document.createElement('span');
    const isFav = r.is_favorite;
    star.className = 'star' + (isFav ? ' active' : '');
    star.textContent = '★';
    star.onclick = () => toggleFavorite(r.id, isFav);
    row.append(h, star);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.innerHTML = `<span>⏱ ${r.time || '—'}</span><span>🍽 ${r.servings || '—'}</span><span>${r.category || '—'}</span>`;

    const collapsible = document.createElement('div');
    collapsible.className = 'card-collapsible';
    collapsible.style.display = 'none';

    const ing = document.createElement('div');
    ing.className = 'card-section';
    ing.innerHTML = '<div class="card-section-title">Ингредиенты</div><div class="card-content">' + (r.ingredients || '').replace(/\n/g, '<br>') + '</div>';

    const st = document.createElement('div');
    st.className = 'card-section';
    st.innerHTML = '<div class="card-section-title">Приготовление</div><div class="card-content">' + (r.steps || '').replace(/\n/g, '<br>') + '</div>';

    if (r.notes && r.notes.trim()) {
      const notes = document.createElement('div');
      notes.className = 'card-section';
      notes.innerHTML = '<div class="card-section-title">Заметки</div><div class="card-content">' + r.notes.replace(/\n/g, '<br>') + '</div>';
      collapsible.append(notes);
    }

    collapsible.append(ing, st);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-expand';
    toggleBtn.innerHTML = '▼ Подробнее';
    toggleBtn.onclick = () => {
      const isOpen = collapsible.style.display === 'block';
      collapsible.style.display = isOpen ? 'none' : 'block';
      toggleBtn.innerHTML = isOpen ? '▼ Подробнее' : '▲ Свернуть';
    };

    const actions = document.createElement('div');
    actions.className = 'actions';
    const bEdit = document.createElement('button');
    bEdit.className = 'btn btn-sm success';
    bEdit.textContent = '✎ Редактировать';
    bEdit.onclick = () => openEditModal(r);
    const bDel = document.createElement('button');
    bDel.className = 'btn btn-sm danger';
    bDel.textContent = '🗑 Удалить';
    bDel.onclick = async () => {
      if (confirm('Удалить рецепт?')) {
        await deleteRecipe(r.id);
      }
    };
    actions.append(bEdit, bDel);

    card.append(row, meta, toggleBtn, collapsible, actions);
    root.append(card);
  });
}

function openEditModal(recipe) {
  const modal = document.getElementById('edit-modal');
  const form = document.getElementById('edit-form');

  document.getElementById('edit-id').value = recipe.id;
  document.getElementById('edit-title').value = recipe.title || '';
  document.getElementById('edit-category').value = recipe.category || '';
  document.getElementById('edit-servings').value = recipe.servings || '';
  document.getElementById('edit-time').value = recipe.time || '';
  document.getElementById('edit-ingredients').value = recipe.ingredients || '';
  document.getElementById('edit-steps').value = recipe.steps || '';
  document.getElementById('edit-notes').value = recipe.notes || '';

  modal.style.display = 'flex';
}

function setupEditModal() {
  const modal = document.getElementById('edit-modal');
  const form = document.getElementById('edit-form');
  const closeBtn = document.getElementById('close-edit-modal');
  const cancelBtn = document.getElementById('cancel-edit');

  closeBtn.onclick = () => {
    modal.style.display = 'none';
  };

  cancelBtn.onclick = () => {
    modal.style.display = 'none';
  };

  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();

    const id = document.getElementById('edit-id').value;
    const title = document.getElementById('edit-title').value.trim();
    const category = document.getElementById('edit-category').value;
    const servings = document.getElementById('edit-servings').value.trim();
    const time = document.getElementById('edit-time').value.trim();
    const ingredients = document.getElementById('edit-ingredients').value.trim();
    const steps = document.getElementById('edit-steps').value.trim();
    const notes = document.getElementById('edit-notes').value.trim();

    if (!title) {
      alert('Укажите название блюда');
      return;
    }

    try {
      await updateRecipe(id, {
        title,
        category,
        servings,
        time,
        ingredients,
        steps,
        notes
      });
      modal.style.display = 'none';
      alert('✅ Рецепт обновлен!');
    } catch (error) {
      console.error('Update recipe error:', error);
      alert('❌ Ошибка при обновлении рецепта: ' + error.message);
    }
  };
}

async function init() {
  setupChat();
  setupManualForm();
  setupVoice();
  setupFilters();
  setupBulkImport();
  setupEditModal();

  await autoImportRecipes();
  loadRecipes();
  subscribeToRecipes(handleRecipeChange);

  if (!sessionStorage.getItem('greeted')) {
    addMsg('assistant', 'Привет! Я ваш шеф-повар 🤖 Надиктуйте или напишите, а я помогу собрать рецепт и подскажу фишки.');
    sessionStorage.setItem('greeted', '1');
  }
}

init();
