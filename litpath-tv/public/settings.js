// LitPath TV settings: Picture, Sound and Network pages.
// Real laptop brightness/volume go to server.js ({event:"sys"}); LED/buzzer settings go to the ESP32 ({event:"remote_settings"}).
window.TVSettings = (() => {
  'use strict';
  const KEY = 'litpath.settings.v1';
  const PICTURE_MODES = ['Standard', 'Vivid', 'Movie', 'Night'];
  const SOUND_MODES = ['Standard', 'Beeps Only', 'Mute'];
  const OUTPUTS = ['TV Speaker', 'Remote'];
  const FILTERS = { Standard: '', Vivid: 'saturate(1.4) contrast(1.1)', Movie: 'sepia(.3) contrast(1.05)', Night: 'sepia(.45) brightness(.7)' };
  const TONES = { wrong: [220, 0.2, 'square', 0.25], click: [1200, 0.04, 'sine', 0.1], test: [880, 0.15, 'sine', 0.25] };

  let s = load(), real = false, remoteOn = false, net = null, ping = null, latency = '';
  let send = () => {}, rerender = () => {}, current = () => null;
  let audio = null, volTimer = 0;

  function load() {
    const d = { pictureMode: 'Standard', brightness: 80, colour: 50, soundMode: 'Standard', volume: 5, output: 'Remote' };
    try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return d; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const cycle = (list, cur, d) => list[(list.indexOf(cur) + d + list.length) % list.length];
  const refresh = cat => { if (current() === cat) rerender(); };

  // Called by app.js for every key on the Picture, Sound and Network pages.
  function press(cat, sub, a) {
    if (cat === 'Network') { if (sub === 2 && a === 'ok') startPing(); return; }
    const d = a === 'right' ? 1 : a === 'left' ? -1 : 0;
    if (!d) return;
    let test = false;
    if (cat === 'Picture') {
      if (sub === 0) s.pictureMode = cycle(PICTURE_MODES, s.pictureMode, d);
      if (sub === 1) { s.brightness = clamp(s.brightness + d * 10, 0, 100); send({ event: 'sys', brightness: s.brightness }); }
      if (sub === 2) s.colour = clamp(s.colour + d * 10, 0, 100);
    } else if (cat === 'Sound') {
      if (sub === 0) {
        const wasMuted = s.soundMode === 'Mute';
        s.soundMode = cycle(SOUND_MODES, s.soundMode, d);
        if (wasMuted !== (s.soundMode === 'Mute')) send({ event: 'sys', volume: s.soundMode === 'Mute' ? 0 : s.volume });
      }
      if (sub === 1) {
        s.volume = clamp(s.volume + d, 0, 10);
        if (s.soundMode !== 'Mute') send({ event: 'sys', volume: s.volume });
        showVolume();
        test = true;
        setTimeout(() => sound('test'), real ? 600 : 0); // give Windows time to apply the new volume
      }
      if (sub === 2) s.output = cycle(OUTPUTS, s.output, d);
    }
    save(); apply(); toRemote(test);
  }

  function apply() {
    const el = document.getElementById('screen');
    const floor = real ? 0.6 : 0.25; // the real screen dims too, so dim the picture less
    if (el) el.style.filter = `brightness(${(floor + (1 - floor) * s.brightness / 100).toFixed(2)}) saturate(${(s.colour / 50).toFixed(2)}) ${FILTERS[s.pictureMode] || ''}`;
  }

  function toRemote(test = false) {
    send({ event: 'remote_settings', brightness: s.brightness, volume: s.volume,
      buzzer: s.soundMode !== 'Mute' && s.output === 'Remote', clicks: s.soundMode === 'Standard', test });
  }

  // Laptop sounds (only when Audio Output is TV Speaker).
  function sound(kind) {
    if (s.soundMode === 'Mute' || s.output !== 'TV Speaker') return;
    if (kind === 'click' && s.soundMode !== 'Standard') return;
    try {
      audio = audio || new AudioContext();
      const [f, dur, type, gain] = TONES[kind], o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(gain * (real ? 1 : s.volume / 10) + 0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
    } catch {}
  }

  function showVolume() {
    const screen = document.getElementById('screen');
    if (!screen) return;
    let el = document.getElementById('volbar');
    if (!el) { el = document.createElement('div'); el.id = 'volbar'; screen.appendChild(el); }
    el.innerHTML = `<span>${s.soundMode === 'Mute' ? '🔇' : '🔊'} ${s.volume}</span><i><b style="width:${s.volume * 10}%"></b></i>`;
    el.classList.add('on');
    clearTimeout(volTimer);
    volTimer = setTimeout(() => el.classList.remove('on'), 1500);
  }

  // Network Test: 5 pings to the ESP32 and back, through the server.
  function startPing() {
    if (!remoteOn) { latency = 'Remote not connected'; return; }
    ping = { id: 0, times: [], sentAt: 0, timer: 0 };
    latency = 'Testing…';
    nextPing();
  }
  function nextPing() {
    if (ping.times.length >= 5) {
      const avg = Math.round(ping.times.reduce((a, b) => a + b, 0) / ping.times.length);
      latency = `Latency: ${avg} ms (best ${Math.round(Math.min(...ping.times))} ms)`;
      ping = null; refresh('Network'); return;
    }
    ping.id++;
    ping.sentAt = performance.now();
    send({ event: 'net_ping', id: ping.id });
    clearTimeout(ping.timer);
    ping.timer = setTimeout(() => { latency = 'No reply from remote'; ping = null; refresh('Network'); }, 2000);
  }
  function pong(id) {
    if (!ping || id !== ping.id) return;
    clearTimeout(ping.timer);
    ping.times.push(performance.now() - ping.sentAt);
    nextPing();
  }

  const level = rssi => rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : rssi >= -85 ? 1 : 0;
  const bars = rssi => '<span class="bars">' + [1, 2, 3, 4].map(i => `<span class="${i <= level(rssi) ? 'on' : ''}" style="height:${i * 25}%"></span>`).join('') + '</span>';
  const duration = sec => sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor(sec / 60) % 60}m` : `${Math.floor(sec / 60)}m ${sec % 60}s`;

  // Right-hand column of each settings row.
  function values(cat) {
    const lr = v => `‹ ${esc(v)} ›`;
    if (cat === 'Picture') return [lr(s.pictureMode), lr(s.brightness), lr(s.colour)];
    if (cat === 'Sound') return [lr(s.soundMode), lr(s.volume), lr(s.output)];
    return [remoteOn && net ? esc(net.ssid) : '—', remoteOn ? 'Connected' : 'Disconnected', 'Press OK'];
  }

  // Info panel text for the selected row (sub = -1 on the main Settings list).
  function info(cat, sub) {
    if (sub < 0) return 'Adjust this setting to make your TV more comfortable to use.';
    if (cat === 'Picture') return [
      'Standard, Vivid, Movie (warm) or Night (dim and warm). Use ◀ ▶ to change.',
      `Brightness ${s.brightness}. ${real ? "Changes the laptop's real screen brightness" : 'Dims the picture'} and the remote's LEDs. Use ◀ ▶.`,
      `Colour ${s.colour}. From greyscale (0) to vivid (100). Use ◀ ▶.`][sub];
    if (cat === 'Sound') return [
      'Standard: beeps and clicks. Beeps Only: no clicks. Mute: silent. Use ◀ ▶.',
      `Volume ${s.volume} / 10. ${real ? "Sets the laptop's real volume" : 'Sets the TV volume'} and the remote buzzer. Use ◀ ▶.`,
      'TV Speaker plays sounds on the laptop. Remote plays them on the buzzer. Use ◀ ▶.'][sub];
    if (!remoteOn) return sub === 2 && latency ? esc(latency) : 'Remote not connected.';
    if (sub === 0) return net ? `${bars(net.rssi)}${esc(net.ssid)}<br>${Number(net.rssi)} dBm (${['Very weak', 'Weak', 'Fair', 'Good', 'Excellent'][level(net.rssi)]})` : 'Waiting for the remote to report…';
    if (sub === 1) return net ? `Connected<br>Remote IP: ${esc(net.ip)}<br>Connected for ${duration(Number(net.uptime) || 0)}` : 'Connected';
    return latency ? esc(latency) : 'Press OK to measure the round-trip time to the remote.';
  }

  // Messages app.js doesn't know about. Returns true if handled.
  function onMessage(m) {
    if (m.event === 'net') { net = m; refresh('Network'); return true; }
    if (m.event === 'net_pong') { pong(m.id); return true; }
    if (m.event === 'sys_state') {
      real = !!m.real;
      if (typeof m.brightness === 'number') { s.brightness = m.brightness; save(); refresh('Picture'); }
      apply();
      return true;
    }
    return false;
  }

  function remoteStatus(on) {
    remoteOn = on;
    if (!on) net = null;
    else toRemote();
    refresh('Network');
  }

  function init(o) { send = o.send; rerender = o.render; current = o.current; apply(); }

  return { init, press, values, info, onMessage, remoteStatus, sound };
})();
