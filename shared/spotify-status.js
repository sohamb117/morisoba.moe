/* Public metadata only. OAuth credentials live in the Worker. */
(function () {
  'use strict';
  const el = id => document.getElementById('spotify-' + id);
  const panel = document.getElementById('p-wave');
  const line = document.getElementById('waveline');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let track = null, received = 0, nextPoll, analysis = null, analysisId = null;
  const analyses = new Map();
  let analysisPending = null, analysisRetry = 0;
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
    if (!track || track.id !== analysisId) { analysisId = track?.id || null; analysis = analyses.get(analysisId) || null; analysisRetry = 0; }
    updateMode();
    if (track?.isPlaying && !analysis && Date.now() >= analysisRetry) loadAnalysis(track.id);
    tick();
  }
  el('art').addEventListener('error', () => { el('art').hidden = true; el('placeholder').hidden = false; });
  async function poll() {
    clearTimeout(nextPoll);
    if (!visible()) { nextPoll = setTimeout(poll,15000); return; }
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
  function visible() { return !document.hidden && !panel.classList.contains('shut') && !panel.classList.contains('closed') && panel.getClientRects().length > 0; }
  function position() {
    const age = track?.sampledAt ? Math.max(0,Math.min(30000,Date.now()-track.sampledAt)) : performance.now()-received;
    return track ? Math.min(track.durationMs,track.progressMs + (track.isPlaying ? age : 0)) : 0;
  }
  function updateMode() {
    const style = window.SpotifyVisualizer.profile(analysis).style;
    el('mode').textContent = analysis?.mode === 'beatgrid' ? 'beat grid · Brizm' : analysis?.features?.tempo ? Math.round(analysis.features.tempo) + ' bpm · ' + style + ' simulation' : 'ambient fallback';
  }
  async function loadAnalysis(id) {
    if (!id || !visible() || analysisPending === id) return;
    analysisPending = id; analysisRetry = Date.now()+60000;
    try {
      const response = await fetch('/api/spotify/analysis?id=' + encodeURIComponent(id),{signal:AbortSignal.timeout(16000),cache:'no-store'});
      if (!response.ok) return;
      const data = await response.json();
      if (data.trackId !== id) return;
      if(analyses.size >= 20) analyses.delete(analyses.keys().next().value);
      analyses.set(id,data);
      if(track?.id === id) {analysis=data;updateMode();}
    } catch (_) {} finally { if(analysisPending===id) analysisPending=null; }
  }
  function tick() {
    let progress = position();
    el('elapsed').textContent = time(progress);
    el('duration').textContent = time(track ? track.durationMs : 0);
    el('progress').max = track ? track.durationMs || 1 : 1;
    el('progress').value = progress;
  }
  // Rhythm-synchronized synthesis; never presented as sampled Spotify audio.
  function frame() {
    if (visible()) {
      const active = track && track.isPlaying && position() < track.durationMs && !reduced.matches;
      line.setAttribute('points', window.SpotifyVisualizer.points(analysis, position()/1000, active));
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { clearTimeout(nextPoll); if (!document.hidden) poll(); });
  setInterval(tick, 1000);
  requestAnimationFrame(frame);
  poll();
})();
