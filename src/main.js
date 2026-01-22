import { supabase } from './lib/supabase.js';
import { getRecipes, addRecipe, updateRecipe, deleteRecipe, toggleFavorite, subscribeToRecipes } from './lib/recipes.js';
import { callOpenAIChat, transcribeAudio } from './lib/ai.js';
import { importBulkRecipes } from './lib/importRecipes.js';

let currentUser = null;
let recipesCache = [];
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

async function init() {
  setupAuth();
  setupChat();
  setupManualForm();
  setupVoice();
  setupFilters();
  setupBulkImport();
}

function setupBulkImport() {
  window.importBulkRecipes = importBulkRecipes;
}

function setupAuth() {
  let isSignInMode = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      currentUser = session.user;
      showMainContent();
      loadRecipes();
      subscribeToRecipes(handleRecipeChange);

      if (!sessionStorage.getItem('greeted')) {
        addMsg('assistant', 'Привет! Я ваш шеф-повар 🤖 Надиктуйте или напишите, а я помогу собрать рецепт и подскажу фишки.');
        sessionStorage.setItem('greeted', '1');
      }
    } else {
      currentUser = null;
      showAuthScreen();
    }
  });

  const tabSignin = document.getElementById('tab-signin');
  const tabSignup = document.getElementById('tab-signup');
  const authForm = document.getElementById('auth-form');
  const btnSubmit = document.getElementById('btn-auth-submit');
  const authError = document.getElementById('auth-error');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');

  tabSignin.onclick = () => {
    isSignInMode = true;
    tabSignin.classList.add('active');
    tabSignup.classList.remove('active');
    btnSubmit.textContent = 'Войти';
    authPassword.setAttribute('autocomplete', 'current-password');
    hideError();
  };

  tabSignup.onclick = () => {
    isSignInMode = false;
    tabSignup.classList.add('active');
    tabSignin.classList.remove('active');
    btnSubmit.textContent = 'Зарегистрироваться';
    authPassword.setAttribute('autocomplete', 'new-password');
    hideError();
  };

  authForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = authEmail.value.trim();
    const password = authPassword.value;

    if (!email || !password) {
      showError('Заполните все поля');
      return;
    }

    if (password.length < 6) {
      showError('Пароль должен быть не менее 6 символов');
      return;
    }

    hideError();
    btnSubmit.disabled = true;
    btnSubmit.textContent = isSignInMode ? 'Вход...' : 'Регистрация...';

    try {
      if (isSignInMode) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password
        });
        if (error) throw error;
        showError('Аккаунт создан! Теперь войдите.', false);
        setTimeout(() => {
          tabSignin.click();
        }, 1500);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = isSignInMode ? 'Войти' : 'Зарегистрироваться';
    }
  };

  function showError(message, isError = true) {
    authError.textContent = message;
    authError.style.display = 'block';
    authError.style.color = isError ? '#dc2626' : '#059669';
  }

  function hideError() {
    authError.style.display = 'none';
  }

  document.getElementById('btn-signout').onclick = async () => {
    await supabase.auth.signOut();
  };
}

function showMainContent() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  document.getElementById('user-info').style.display = 'flex';

  const avatar = document.getElementById('user-avatar');
  if (currentUser?.user_metadata?.avatar_url) {
    avatar.src = currentUser.user_metadata.avatar_url;
    avatar.style.display = 'block';
  } else {
    avatar.style.display = 'none';
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('main-content').style.display = 'none';
  document.getElementById('user-info').style.display = 'none';
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
}

function render() {
  const root = document.getElementById('cards');
  const q = (document.getElementById('search').value || '').toLowerCase();
  const cat = document.getElementById('filter-category').value;
  const tmax = Number(document.getElementById('filter-time').value || 0);
  const fav = document.getElementById('filter-fav').value;

  const filtered = recipesCache.filter(r => {
    const inQ = !q ||
      (r.title || '').toLowerCase().includes(q) ||
      (r.ingredients || '').toLowerCase().includes(q);
    const inCat = !cat || (r.category || '') === cat;
    const timeVal = parseInt((r.time || '0').replace(/\D/g, '')) || 999;
    const inTime = !tmax || timeVal <= tmax;
    const isFav = r.is_favorite;
    const inFav = fav === 'all' || (fav === 'only' && isFav) || (fav === 'exclude' && !isFav);
    return inQ && inCat && inTime && inFav;
  });

  root.innerHTML = '';

  if (filtered.length === 0) {
    root.innerHTML = '<div class="empty-state"><div style="font-size:3rem;margin-bottom:1rem">🍽️</div><p>Пока нет рецептов по выбранным фильтрам</p></div>';
    return;
  }

  filtered.forEach(r => {
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

    const ing = document.createElement('div');
    ing.className = 'card-section';
    ing.innerHTML = '<div class="card-section-title">Ингредиенты</div><div class="card-content">' + (r.ingredients || '').replace(/\n/g, '<br>') + '</div>';

    const st = document.createElement('div');
    st.className = 'card-section';
    st.innerHTML = '<div class="card-section-title">Приготовление</div><div class="card-content">' + (r.steps || '').replace(/\n/g, '<br>') + '</div>';

    const actions = document.createElement('div');
    actions.className = 'actions';
    const bEdit = document.createElement('button');
    bEdit.className = 'btn btn-sm success';
    bEdit.textContent = '✎ Редактировать';
    bEdit.onclick = () => editRecipe(r);
    const bDel = document.createElement('button');
    bDel.className = 'btn btn-sm danger';
    bDel.textContent = '🗑 Удалить';
    bDel.onclick = async () => {
      if (confirm('Удалить рецепт?')) {
        await deleteRecipe(r.id);
      }
    };
    actions.append(bEdit, bDel);

    card.append(row, meta, ing, st, actions);
    root.append(card);
  });
}

function editRecipe(r) {
  const t = prompt('Название', r.title || '') || r.title;
  const cat = prompt('Категория', r.category || '') || r.category;
  const sv = prompt('Порции', r.servings || '') || r.servings;
  const tm = prompt('Общее время (мин)', r.time || '') || r.time;
  const ing = prompt('Ингредиенты (каждый с новой строки)', r.ingredients || '') || r.ingredients;
  const st = prompt('Шаги (каждый с новой строки)', r.steps || '') || r.steps;
  updateRecipe(r.id, {
    title: t,
    category: cat,
    servings: sv,
    time: tm,
    ingredients: ing,
    steps: st
  });
}

init();
