(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = [
      'Prime',
      'Netflix',
      'YouTube',
      'Music',
      'Photos',
      'Live TV',
      'Settings',
      'Browser',
      'Games',
    ],
    icons = ['P', 'N', '▶', '♫', '✿', '▣', '⚙', '◎', '◆'],
    colors = [
      '#1677c8',
      '#a70d19',
      '#e62117',
      '#a14bcb',
      '#d49b24',
      '#1e9678',
      '#52627b',
      '#2877d7',
      '#7659ce',
    ];
  let tasks = [],
    ws,
    view = false,
    demo = true,
    guided = true,
    menu = false,
    menuIndex = 0,
    task = null,
    step = 0,
    start = 0,
    wrong = 0,
    hints = 0,
    runMode = 'demo',
    prev = null,
    log = [],
    pairs = {},
    stats = readStats(),
    state = initial(),
    subtitle = false,
    large = false,
    contrast = false;
  const allowed = ['home', 'up', 'down', 'left', 'right', 'ok', 'back'];
  function initial() {
    return { screen: 'HOME', row: 0, col: 0, app: null, setting: 0, sub: 0, category: null };
  }
  function safe(v) {
    return String(v).replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }
  function transition(s, a) {
    s = { ...s };
    if (!allowed.includes(a)) return s;
    if (a === 'home') return initial();
    if (s.screen === 'HOME') {
      if (a === 'up') s.row = Math.max(0, s.row - 1);
      if (a === 'down') s.row = Math.min(2, s.row + 1);
      if (a === 'left') s.col = Math.max(0, s.col - 1);
      if (a === 'right') s.col = Math.min(2, s.col + 1);
      if (a === 'ok') {
        let i = s.row * 3 + s.col;
        if (i === 6) {
          s.screen = 'SETTINGS';
          s.setting = 0;
        } else {
          s.screen = 'APP';
          s.app = names[i];
        }
      }
    } else if (s.screen === 'APP' && a === 'back') {
      let i = names.indexOf(s.app);
      s = initial();
      s.row = Math.floor(i / 3);
      s.col = i % 3;
    } else if (s.screen === 'SETTINGS') {
      if (a === 'up') s.setting = Math.max(0, s.setting - 1);
      if (a === 'down') s.setting = Math.min(3, s.setting + 1);
      if (a === 'ok') {
        s.screen = 'SETTINGS_SUB';
        s.category = ['Picture', 'Sound', 'Network', 'Accessibility'][s.setting];
        s.sub = 0;
      }
      if (a === 'back') s = initial();
    } else if (s.screen === 'SETTINGS_SUB') {
      let n = s.category === 'Accessibility' ? 3 : 3;
      if (a === 'up') s.sub = Math.max(0, s.sub - 1);
      if (a === 'down') s.sub = Math.min(n - 1, s.sub + 1);
      if (a === 'ok' && s.category === 'Accessibility') {
        if (s.sub === 0) subtitle = !subtitle;
        if (s.sub === 1) large = !large;
        if (s.sub === 2) contrast = !contrast;
      }
      if (a === 'back') {
        s.screen = 'SETTINGS';
        s.setting = ['Picture', 'Sound', 'Network', 'Accessibility'].indexOf(s.category);
        s.sub = 0;
      }
    }
    return s;
  }
  function render() {
    document.body.classList.toggle('large', large);
    document.body.classList.toggle('contrast', contrast);
    let c = $('content');
    if (state.screen === 'HOME') {
      c.innerHTML = `<div class="home"><h1>What would you like to watch?</h1><p class="sub">Choose an app to get started</p><div class="grid">${names.map((n, i) => `<div class="tile ${i === state.row * 3 + state.col ? 'selected' : ''}" data-app="${n}"><span class="ico" style="background:${colors[i]}">${icons[i]}</span><span class="label">${n === 'Prime' ? 'Prime Video' : n}</span></div>`).join('')}</div><div class="screenfoot"><span>Good to see you</span><span>HOME</span></div></div>`;
    } else if (state.screen === 'APP') {
      let i = names.indexOf(state.app);
      c.innerHTML = `<div class="appview" style="--appcolor:${colors[i]}"><div class="hero"><div class="bigico">${icons[i]}</div><div><h1>${state.app === 'Prime' ? 'Prime Video' : safe(state.app)}</h1><p class="sub">Welcome back</p></div></div><div class="contenttiles">${['Featured', 'Continue watching', 'Recommended', 'For you'].map(x => `<div class="fake">${x}</div>`).join('')}</div><div class="screenfoot"><span>Explore something new</span><span>${safe(state.app.toUpperCase())}</span></div></div>`;
    } else {
      let cats = ['Picture', 'Sound', 'Network', 'Accessibility'],
        cat = state.screen === 'SETTINGS' ? cats[state.setting] : state.category,
        opts =
          cat === 'Accessibility'
            ? ['Subtitles', 'Large Text', 'High Contrast']
            : cat === 'Picture'
              ? ['Picture Mode', 'Brightness', 'Colour']
              : cat === 'Sound'
                ? ['Sound Mode', 'Volume', 'Audio Output']
                : ['Wi-Fi', 'Connection Status', 'Network Test'],
        vals =
          cat === 'Accessibility'
            ? [subtitle, large, contrast].map(x => (x ? 'ON' : 'OFF'))
            : ['Standard', 'Default', 'Auto'];
      c.innerHTML = `<div class="settings"><h1>${state.screen === 'SETTINGS' ? 'Settings' : safe(cat)}</h1><p class="sub">${state.screen === 'SETTINGS' ? 'Make your TV work for you' : 'Personalise your viewing experience'}</p><div class="settingslayout"><div>${(state.screen === 'SETTINGS' ? cats : opts).map((x, i) => `<div class="setting ${i === (state.screen === 'SETTINGS' ? state.setting : state.sub) ? 'selected' : ''}"><span>${x}</span><span class="value">${state.screen === 'SETTINGS' ? '›' : cat === 'Accessibility' ? vals[i] : vals[i] || '›'}</span></div>`).join('')}</div><div class="info"><h2>${safe(state.screen === 'SETTINGS' ? cat : opts[state.sub])}</h2><p>${cat === 'Accessibility' ? (state.sub === 0 ? (subtitle ? 'Subtitles are enabled.' : 'Subtitles are disabled.') : state.sub === 1 ? (large ? 'Large text is enabled.' : 'Large text is disabled.') : contrast ? 'High contrast is enabled.' : 'High contrast is disabled.') : 'Adjust this setting to make your TV more comfortable to use.'}</p></div></div><div class="screenfoot"><span>Accessibility and preferences</span><span>SETTINGS</span></div></div>`;
    }
    
if (menu) {
  let old = $('taskmenu');

  if (old) old.remove();

  let visibleTasks = getVisibleTasks();

  let ov = document.createElement('div');

  ov.id = 'taskmenu';
  ov.className = 'menu-overlay';

  ov.innerHTML = `
    <h2>What would you like to do?</h2>

    ${visibleTasks.map((t, i) => `
      <button
        class="menuitem ${i === menuIndex ? 'selected' : ''}"
        data-menu="${i}"
      >
        ${safe(t.name)}
      </button>
    `).join('')}
  `;

  c.appendChild(ov);
}

  }
  function mirror(button, kind = 'lit') {
    document.querySelectorAll('[data-key]').forEach(b => {
      b.classList.remove('lit', 'wrong', 'preview');
      if (button !== 'none' && b.dataset.key === button) b.classList.add(kind);
    });
  }
  function addLog(src, msg, warn = false) {
    log.unshift({ t: new Date().toLocaleTimeString(), src, msg, warn });
    log = log.slice(0, 50);
    $('log').innerHTML = log
      .map(
        x =>
          `<div class="logitem ${x.warn ? 'warn' : ''}">${safe(x.t)} · ${safe(x.src)} · ${safe(x.msg)}</div>`,
      )
      .join('');
  }
  function send(o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
  }
  function status(connected) {
    $('status').textContent = connected ? '● Remote connected' : '● Waiting for remote...';
    $('status').classList.toggle('on', connected);
  }
  
function getTaskSteps(task) {
  const g = task.goal;

  // Keep existing steps for HOME tasks
  if (task.category === 'HOME') {
    return [...task.steps];
  }

  let steps = [];

  // Navigate to Settings only if we are not already there
  if (state.screen === 'HOME') {
    steps.push('down', 'down', 'ok');
  }

  // Navigate to the required Settings category
  const categories = [
    'Picture',
    'Sound',
    'Network',
    'Accessibility'
  ];

  if (g.category) {
    let currentCategory =
      state.screen === 'SETTINGS'
        ? categories[state.setting]
        : state.category;

    if (state.screen !== 'SETTINGS_SUB' ||
        currentCategory !== g.category) {

      if (state.screen === 'SETTINGS_SUB') {
        steps.push('back');
      }

      let target = categories.indexOf(g.category);

      if (target >= 0) {
        let current = state.screen === 'SETTINGS'
          ? state.setting
          : 0;

        while (current < target) {
          steps.push('down');
          current++;
        }

        while (current > target) {
          steps.push('up');
          current--;
        }

        steps.push('ok');
      }
    }
  }

  // Navigate to the required setting
  if (g.setting) {
    const options =
      g.category === 'Accessibility'
        ? ['Subtitles', 'Large Text', 'High Contrast']
        : g.category === 'Picture'
          ? ['Picture Mode', 'Brightness', 'Colour']
          : [];

    let target = options.indexOf(g.setting);

    if (target >= 0) {
      let current = 0;

      if (
        state.screen === 'SETTINGS_SUB' &&
        state.category === g.category
      ) {
        current = state.sub;
      }

      while (current < target) {
        steps.push('down');
        current++;
      }

      while (current > target) {
        steps.push('up');
        current--;
      }

      steps.push('ok');
    }
  }

  return steps;
}

 
function startTask(id, mode = 'demo') {
  task = tasks.find(t => t.id === id);

  if (!task) return;

  // Generate steps from the current screen
  task = {
    ...task,
    steps: getTaskSteps(task)
  };

  step = 0;
  wrong = 0;
  hints = 0;
  start = Date.now();
  runMode = mode;
  menu = false;

  // IMPORTANT:
  // Do not reset state to HOME here
  // state = initial();  <-- REMOVE THIS

  $('chip').textContent = 'Goal: ' + task.name;
  $('chip').classList.remove('hidden');
  $('success').classList.add('hidden');

  render();
  stepsRender();

  if (demo && guided && task.steps.length > 0) {
    mirror(task.steps[0]);
  }

  // Send the dynamically generated steps to ESP32
  send({
    event: 'task_start',
    task: task.id,
    steps: task.steps
  });

  addLog('local', `task_start ${task.id}`);
}

  function stepsRender() {
    if (!task) {
      $('steps').innerHTML = '<li>Start a task to show its path.</li>';
      $('stepcount').textContent = 'No active task';
      return;
    }
    $('stepcount').textContent = `${Math.min(step, task.steps.length)} / ${task.steps.length}`;
    $('steps').innerHTML = task.steps
      .map(
        (a, i) =>
          `<li class="${i < step ? 'done' : i === step ? 'current' : ''}">${i < step ? '✓' : i === step ? '●' : '○'} &nbsp; ${a.toUpperCase()}</li>`,
      )
      .join('');
  }
  function goalOK(t) {
    let g = t.goal;
    if (g.app) return state.screen === 'APP' && state.app === g.app;
    if (g.screen && state.screen !== g.screen) return false;
    if (g.category && state.category !== g.category) return false;
    if (g.setting === 'Subtitles' && subtitle !== g.value) return false;
    return true;
  }
  function complete(id, mode = runMode) {
    if (!task || task.id !== id) return;
    let seconds = +((Date.now() - start) / 1000).toFixed(1);
    stats.unshift({
      task: task.name,
      id,
      time: seconds,
      wrong,
      hints,
      mode,
      timestamp: new Date().toLocaleString(),
    });
    stats = stats.slice(0, 100);
    saveStats();
    if (!goalOK(task)) addLog('warning', 'Goal state mismatch', true);
    $('success').textContent =
      task.id === 'SUBTITLES_ON'
        ? 'Subtitles turned on ✓'
        : (task.goal.app || task.name.replace('Open ', '') + ' opened') + ' ✓';
    $('success').classList.remove('hidden');
    setTimeout(() => $('success').classList.add('hidden'), 3000);
    addLog('local', `task_complete ${id}; ${seconds}s; wrong=${wrong}; hints=${hints}`);
    task = null;
    $('chip').classList.add('hidden');
    stepsRender();
    renderStats();
  }
  function action(a, source = 'local') {
    if (!allowed.includes(a)) {
      addLog('warning', 'Unknown action ignored', true);
      return;
    }
    
if (menu) {

  const visibleTasks = getVisibleTasks();

  if (visibleTasks.length === 0) {
    menu = false;
    render();
    return;
  }

  if (a === 'up') {

    menuIndex = Math.max(0, menuIndex - 1);

  }

  else if (a === 'down') {

    menuIndex = Math.min(
      visibleTasks.length - 1,
      menuIndex + 1
    );

  }

  else if (a === 'ok') {

    const selectedTask = visibleTasks[menuIndex];

    if (selectedTask) {

      menu = false;

      startTask(selectedTask.id);

    }

    return;

  }

  else if (a === 'back' || a === 'home') {

    menu = false;

  }

  render();

  return;

}

    let before = JSON.stringify(state),
      expected = task && task.steps[step];
    if (task && step < task.steps.length && a !== expected) {
      wrong++;
      pairs[expected + '→' + a] = (pairs[expected + '→' + a] || 0) + 1;
      renderPairs();
      addLog('warning', `wrong press expected ${expected}, pressed ${a}`, true);
      $('flash').classList.remove('on');
      void $('flash').offsetWidth;
      $('flash').classList.add('on');
      if (demo && source === 'local') {
        mirror(a, 'wrong');
        setTimeout(() => mirror((task && task.steps[step]) || 'none'), 450);
        return;
      }
    }
    state = transition(state, a);
    render();
    addLog(source, `action ${a}`);
    if (task && a === expected) {
      step++;
      stepsRender();
      if (step >= task.steps.length) {
        if (source === 'local' || source === 'demo') complete(task.id, runMode);
      } else if (demo && guided) mirror(task.steps[step]);
    } else if (task && demo && source === 'local') {
      state = JSON.parse(before);
      render();
    }
  }
  function renderStats() {
    let avg = mode => {
      let a = stats.filter(x => x.mode === mode);
      return a.length ? (a.reduce((s, x) => s + x.time, 0) / a.length).toFixed(1) : '—';
    };
    $('summary').textContent =
      `Completed: ${stats.length} · Guided average: ${avg('guided')}s · Unguided average: ${avg('unguided')}s`;
    $('stats').innerHTML =
      stats
        .slice(0, 10)
        .map(
          x =>
            `<tr><td>${safe(x.task)}</td><td>${x.time}</td><td>${x.wrong}</td><td>${x.hints}</td><td>${safe(x.mode)}</td><td>${safe(x.timestamp)}</td></tr>`,
        )
        .join('') || '<tr><td colspan="6">No completed tasks yet.</td></tr>';
  }
  function renderPairs() {
    $('pairs').innerHTML =
      Object.entries(pairs)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([k, v]) =>
            `<tr><td>${safe(k.split('→')[0])}</td><td>${safe(k.split('→')[1])}</td><td>${v}</td></tr>`,
        )
        .join('') || '<tr><td colspan="3">No wrong presses yet.</td></tr>';
  }
  function readStats() {
    try {
      let v = JSON.parse(localStorage.getItem('litpath.stats.v1') || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function saveStats() {
    try {
      localStorage.setItem('litpath.stats.v1', JSON.stringify(stats));
    } catch {}
  }
  function setView(v) {
    view = v;
    $('layout').className = 'layout ' + (v ? 'presenter' : 'user');
    $('toggle').innerHTML = (v ? 'User view' : 'Presenter view') + ' <kbd>P</kbd>';
  }
  function connect() {
    let proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/tv`);
    ws.onopen = () => addLog('local', 'WebSocket connected');
    ws.onclose = () => {
      status(false);
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = e => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        addLog('warning', 'Malformed JSON ignored', true);
        return;
      }
      if (m.event === 'remote_status') status(!!m.connected);
      else if (m.event === 'tasks' && Array.isArray(m.tasks)) {
        tasks = m.tasks.filter(t => t && t.id && Array.isArray(t.steps));
        fillTasks();
        addLog('incoming', `${tasks.length} tasks received`);
      } else if (m.action) action(m.action, 'remote');
      

else if (m.event === 'menu') {

  const visibleTasks = getVisibleTasks();

  if (visibleTasks.length > 0) {

    menu = true;

    // Start from the first filtered task
    menuIndex = 0;

    // Send the filtered list to the ESP32
    send({
      event: 'tasks',
      tasks: visibleTasks
    });

  } else {

    menu = false;

  }

  render();

}

else if (m.event === 'task_start') startTask(m.task, guided ? 'guided' : 'unguided');
      else if (m.event === 'led') {
        mirror(m.button || 'none');
        addLog('incoming', 'led ' + m.button);
      } else if (m.event === 'preview') {
        mirror(m.button, 'preview');
        setTimeout(() => mirror('none', ''), 400);
        addLog('incoming', 'preview ' + m.button);
      } else if (m.event === 'wrong') {
        wrong++;
        pairs[m.expected + '→' + m.pressed] = (pairs[m.expected + '→' + m.pressed] || 0) + 1;
        renderPairs();
        $('flash').classList.add('on');
        mirror(m.pressed, 'wrong');
        addLog('warning', `wrong ${m.expected}→${m.pressed}`, true);
      } else if (m.event === 'task_complete') complete(m.task, guided ? 'guided' : 'unguided');
      else if (m.event === 'hint') {
        hints++;
        addLog('incoming', 'hint level ' + m.level);
      } else addLog('incoming', JSON.stringify(m));
    };
  }

  
function getVisibleTasks() {
  if (state.screen === 'HOME') {
    return tasks.filter(task =>
      task.category === 'HOME' ||
      task.category === 'GENERAL'
    );
  }

  if (
    state.screen === 'SETTINGS' ||
    state.screen === 'SETTINGS_SUB'
  ) {
    return tasks.filter(task =>
      task.category === 'SETTINGS' ||
      task.category === 'GENERAL'
    );
  }

  return [];
}

  function fillTasks() {
    const select = $('task');
    select.innerHTML = tasks.length
      ? tasks.map(t => `<option value="${safe(t.id)}">${safe(t.name)}</option>`).join('')
      : '<option value="">Tasks could not load — refresh or check server</option>';
    select.disabled = !tasks.length;
  }
  async function initTasks() {
    try {
      let r = await fetch('/tasks.json');
      tasks = await r.json();
      fillTasks();
    } catch (e) {
      addLog('warning', 'Could not load tasks.json', true);
    }
  }
  $('toggle').onclick = () => setView(!view);
  $('demo').onchange = e => {
    demo = e.target.checked;
    addLog('local', 'demo ' + demo);
  };
  $('guided').onchange = e => {
    guided = e.target.checked;
    send({ event: 'mode', guided });
    if (!guided) mirror('none', '');
    else if (task) mirror(task.steps[step]);
    addLog('local', 'guided ' + guided);
  };
  $('start').onclick = () => startTask($('task').value, 'demo');
  
$('menu').onclick = () => {

  setView(true);

  const visibleTasks = getVisibleTasks();

  if (visibleTasks.length > 0) {

    menu = true;

    menuIndex = 0;

  } else {

    menu = false;

  }

  render();

};

  $('remote').onclick = e => {
    let b = e.target.closest('[data-key]');
    if (b) {
      if (demo) action(b.dataset.key, 'local');
      else send({ action: b.dataset.key });
    }
  };
  document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key.toLowerCase() === 'p') {
      setView(!view);
      return;
    }
    let a = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Enter: 'ok',
      Escape: 'back',
      Backspace: 'back',
      h: 'home',
    }[e.key];
    if (a) {
      e.preventDefault();
      action(a, 'local');
    }
  });
  $('clear').onclick = () => {
    if (confirm('Clear all saved statistics?')) {
      stats = [];
      saveStats();
      renderStats();
    }
  };
  $('clearlog').onclick = () => {
    log = [];
    $('log').innerHTML = '';
  };
  $('csv').onclick = () => {
    let rows = [
        ['Task', 'ID', 'Time', 'Wrong', 'Hints', 'Mode', 'Timestamp'],
        ...stats.map(x => [x.task, x.id, x.time, x.wrong, x.hints, x.mode, x.timestamp]),
      ],
      csv = rows
        .map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))
        .join('\r\n'),
      url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      a = document.createElement('a');
    a.href = url;
    a.download = 'litpath-stats.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  setView(false);
  render();
  renderStats();
  renderPairs();
  initTasks();
  connect();
})();