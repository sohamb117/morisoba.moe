/* Public metadata only. OAuth credentials live in the Worker. */
(function () {
  'use strict';
  const el = id => document.getElementById('spotify-' + id);
  const panel = document.getElementById('p-wave');
  const line = document.getElementById('waveline');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let track = null, received = 0, nextPoll;
  const time = ms => { const seconds = Math.floor(Math.max(0, ms) / 1000); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); };
  function render(data, state) {
    track = data && data.title ? data : null;
    received = performance.now();
    el('state').textContent = 'spotify · ' + (state || (track ? (track.isPlaying ? 'now playing' : 'paused') : 'off air'));
    el('title').textContent = track ? track.title : 'Nothing playing';
    el('artist').textContent = track ? track.artist : '';
    el('album').textContent = track ? track.album : '';
    el('title').removeAttribute('href');
    if (track && /^https:\/\/open\.spotify\.com\//.test(track.url || '')) {
      el('title').href = track.url;
      el('title').target = '_blank';
      el('title').rel = 'noopener noreferrer';
    }
    const art = track && /^https:\/\/i\.scdn\.co\//.test(track.art || '') ? track.art : '';
    el('art').hidden = !art;
    el('placeholder').hidden = !!art;
    if (art) { el('art').src = art; el('art').alt = track.album + ' album cover'; }
    else { el('art').removeAttribute('src'); el('art').alt = ''; }
    tick();
  }
  el('art').addEventListener('error', () => { el('art').hidden = true; el('placeholder').hidden = false; });
  async function poll() {
    clearTimeout(nextPoll);
    if (document.hidden) return;
    let delay = 15000;
    try {
      const response = await fetch('/api/spotify', {signal: AbortSignal.timeout(8000), cache: 'no-store'});
      if (response.status === 429) { delay = Math.max(15000, Math.min(300000, Number(response.headers.get('Retry-After') || 30) * 1000)); throw new Error('rate limited'); }
      if (!response.ok) throw new Error('offline');
      const data = await response.json();
      render(data, data.state);
    } catch (_) { render(null, 'signal unavailable'); }
    nextPoll = setTimeout(poll, delay);
  }
  function tick() {
    let progress = track ? Math.min(track.durationMs, track.progressMs + (track.isPlaying ? performance.now() - received : 0)) : 0;
    el('elapsed').textContent = time(progress);
    el('duration').textContent = time(track ? track.durationMs : 0);
    el('progress').max = track ? track.durationMs || 1 : 1;
    el('progress').value = progress;
  }
  // Decorative oscilloscope follows play/pause, not Spotify audio frequencies.
  function frame(now) {
    if (!document.hidden && !panel.classList.contains('closed') && panel.getClientRects().length) {
      const active = track && track.isPlaying && !reduced.matches;
      const phase = now / 1000 * 2.9;
      let points = '';
      for (let x = 0; x <= 220; x += 2) {
        const y = active ? 32 + 9 * Math.sin(x * .09 + phase) + 4 * Math.sin(x * .23 - phase * 1.7) : 32;
        points += x + ',' + y.toFixed(1) + ' ';
      }
      line.setAttribute('points', points);
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { clearTimeout(nextPoll); if (!document.hidden) poll(); });
  setInterval(tick, 1000);
  requestAnimationFrame(frame);
  poll();
})();
