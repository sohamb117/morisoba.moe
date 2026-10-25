/* morisoba // sound skin
   Reusable behavior: .ui-sound-nav / .ui-sound-select, or data-ui-sound="nav|select".
   Ordinary links between documents get navigation sound automatically.
   In JS, use MorisobaUI.navigate(url) for programmatic page transitions. */
(function () {
  'use strict';
  if (window.MorisobaUI) return;

  var STORAGE_KEY = 'morisoba.uiSound.muted';
  var ctx = null;
  var lastSoundAt = -Infinity;
  var muted = false;
  try { muted = localStorage.getItem(STORAGE_KEY) === 'true'; } catch (_) {}

  function play(kind) {
    if (muted) return false;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    var now = performance.now();
    if (now - lastSoundAt < 75) return false; // delegated + direct listeners must not double-play
    lastSoundAt = now;
    try {
      if (!ctx) ctx = new AudioContextClass();
      if (ctx.state === 'suspended') {
        var resume = ctx.resume();
        if (resume && resume.catch) resume.catch(function () {});
      }

      // A short, soft, 8-bit Macintosh System 7-style selection chirp.
      // Synthesized rather than bundling copyrighted Apple system audio.
      var t = ctx.currentTime + .002;
      var nav = kind === 'nav' || kind === 'navigate';
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = nav ? 1850 : 1500;
      o.type = 'square';
      o.frequency.setValueAtTime(nav ? 932 : 740, t);
      o.frequency.exponentialRampToValueAtTime(nav ? 740 : 590, t + (nav ? .057 : .043));
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(nav ? .023 : .018, t + .004);
      g.gain.exponentialRampToValueAtTime(.0001, t + (nav ? .070 : .052));
      o.connect(filter);
      filter.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + (nav ? .073 : .055));
      o.onended = function () { o.disconnect(); filter.disconnect(); g.disconnect(); };
      return true;
    } catch (_) {
      // No audio device, denied playback or unsupported API must never block navigation.
      return false;
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    try { localStorage.setItem(STORAGE_KEY, String(muted)); } catch (_) {}
    return muted;
  }

  function navigate(url, options) {
    options = options || {};
    play('nav');
    var destination = String(url);
    if (options.newTab) {
      window.open(destination, '_blank', 'noopener');
      return;
    }
    // Preserve the brief click before unloading the audio context.
    window.setTimeout(function () {
      if (options.replace) location.replace(destination);
      else location.assign(destination);
    }, 72);
  }

  function documentChange(link) {
    if (link.hasAttribute('download') || link.dataset.uiSound === 'off') return false;
    var raw = link.getAttribute('href');
    if (!raw || raw.charAt(0) === '#') return false;
    var url;
    try { url = new URL(link.href, location.href); } catch (_) { return false; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // A different hash in the same document isn't a page switch.
    if (url.origin === location.origin && url.pathname === location.pathname &&
        url.search === location.search) return false;
    return true;
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var link = target.closest('a[href]');
    if (link) {
      if (!documentChange(link)) return;
      play('nav');
      // Only delay normal same-tab clicks; never hijack modifiers, targets or downloads.
      // A 72ms delay lets the chirp finish instead of being cut off by document unload.
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      var targetName = (link.getAttribute('target') || '').toLowerCase();
      if (targetName && targetName !== '_self') return;
      // Preserve native external-link behavior (referrer policy, link tracking,
      // downloads, browser gesture handling); only hold same-origin page loads.
      var destination;
      try { destination = new URL(link.href, location.href); } catch (_) { return; }
      if (destination.origin !== location.origin || link.hasAttribute('ping') ||
          link.hasAttribute('referrerpolicy') || (" " + (link.rel || "") + " ").includes(" noreferrer ")) return;
      if (!event.cancelable) return;
      event.preventDefault();
      var url = link.href;
      window.setTimeout(function () { location.assign(url); }, 72);
      return;
    }
    var marked = target.closest('.ui-sound-nav, .ui-sound-select, [data-ui-sound="nav"], [data-ui-sound="select"]');
    if (!marked || marked.hasAttribute('disabled') || marked.getAttribute('aria-disabled') === 'true') return;
    play(marked.matches('.ui-sound-nav, [data-ui-sound="nav"]') ? 'nav' : 'select');
  });

  document.addEventListener('submit', function (event) {
    if (!event.defaultPrevented) play('nav');
  });

  window.MorisobaUI = {
    play: play,
    navigate: navigate,
    setMuted: setMuted,
    isMuted: function () { return muted; }
  };
})();
