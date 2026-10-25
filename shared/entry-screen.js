/* Keep the first entry frame stable on cold loads, return links and logout. */
(function () {
  'use strict';
  var root = document.documentElement;
  var gate = document.getElementById('entry-gate');
  if (!gate) return;
  var documentReady = document.readyState === 'complete' ? Promise.resolve() : new Promise(function (resolve) {
    document.addEventListener('DOMContentLoaded', resolve, {once:true});
  });
  var fonts = document.fonts;
  var faces = ['14px "MicroKnight"', '42px "Xerox Classic"', '18px "Xerox Classic Small"'];
  var fontReady = fonts ? Promise.all(faces.map(function (face) {
    return fonts.load(face).then(function (loaded) {
      if (!loaded.length) throw new Error('Entry font unavailable');
    });
  })) : Promise.reject(new Error('Font loading unavailable'));
  var emblem = gate.querySelector('.entry-sigil');
  var imageReady = emblem && emblem.decode ? emblem.decode().catch(function () {}) : Promise.resolve();
  // A stalled font request must not strand the entry controls. Freeze a readable
  // fallback for this visit instead of allowing a late font swap after reveal.
  var timeout;
  var deadline = new Promise(function (resolve) {
    timeout = setTimeout(function () { resolve(false); }, 2000);
  });
  var assets = Promise.all([fontReady, imageReady]).then(function () { return true; }, function () { return false; });
  window.MorisobaEntryReady = Promise.race([assets, deadline]).then(function (loaded) {
    clearTimeout(timeout);
    if (!loaded) root.classList.add('entry-font-fallback');
    return documentReady.then(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          root.classList.remove('entry-pending');
          resolve();
        });
      });
    });
  });
})();
