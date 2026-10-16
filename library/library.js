/* The library reads committed snapshots. Visitors never need third-party APIs. */
(function () {
  'use strict';
  const M = LibraryData;
  const names = {local: 'handwritten', letterboxd: 'letterboxd', myanimelist: 'myanimelist'};
  const labels = {books: 'books', films: 'films', shows: 'series', manga: 'manga'};
  const shelves = Object.keys(labels);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let items = [], selected = null, returnFocus = null;
  async function read(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const value = await res.json();
    if (path.includes('/imports/') && !M.validSnapshot(value)) throw new Error('Invalid import snapshot');
    if (path.endsWith('/library.json') && !M.kinds.slice(0, 3).every(k => Array.isArray(value?.[k]))) throw new Error('Invalid handwritten library');
    if (path.endsWith('/library-links.json') && (!Array.isArray(value) || !value.every(g => Array.isArray(g.ids)))) throw new Error('Invalid entry links');
    return value;
  }
  function closeReader() {
    document.getElementById('p-detail').style.display = 'none';
    document.body.classList.remove('modal-open');
    document.getElementById('p-detail').removeAttribute('aria-modal');
    document.getElementById('p-detail').removeAttribute('role');
    selected = null;
    document.querySelectorAll('.row.selected').forEach(row => row.classList.remove('selected'));
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  function sourceLink(url, label) {
    const safe = M.safeUrl(url);
    return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label);
  }
  function detail(item, row) {
    selected = item.id;
    returnFocus = row;
    document.querySelectorAll('.row.selected').forEach(el => el.classList.remove('selected'));
    row.classList.add('selected');
    const panel = document.getElementById('p-detail');
    panel.style.display = '';
    const dates = [item.started && `started ${item.started}`, item.finished && `finished ${item.finished}`, item.seasons && `${item.seasons} seasons`].filter(Boolean);
    panel.querySelector('.pbody').innerHTML = `
      <div class="d-title">${esc(item.title)}</div>
      <div class="d-byline">${esc(item.author || item.director || item.creator || '')}</div>
      <div class="d-meta">${esc([M.status(item), item.year, ...dates].filter(Boolean).join(' · '))}</div>
      ${item.source === 'local' ? `<div class="d-rating">${esc(M.rating(item))} · handwritten</div>` : ''}
      ${item.notes ? `<div class="d-notes">${esc(item.notes)}</div>` : ''}
      ${item.imports.map(entry => `<div class="source-record">
        <div>${sourceLink(entry.url, names[entry.source])} <span class="source-score">${esc(M.rating(entry))}</span></div>
        <div>${esc(entry.title)} · ${esc(entry.format)} · ${esc(entry.status)}</div>
        ${entry.progress ? `<div>${entry.progress.value} / ${entry.progress.total ?? '?'} ${esc(entry.progress.unit)}</div>` : ''}
        ${entry.sourceStarted ? `<div>started ${esc(entry.sourceStarted)} (MAL date)</div>` : ''}
        ${entry.sourceFinished ? `<div>finished ${esc(entry.sourceFinished)} (MAL date)</div>` : ''}
        <div>${sourceLink(entry.userUrl, entry.source === 'letterboxd' ? 'view on profile' : 'view list')}</div>
      </div>`).join('')}
      ${!item.notes && !item.imports.length ? '<div class="empty">[ no notes yet ]</div>' : ''}`;
    if (matchMedia('(max-width: 720px)').matches) {
      document.body.classList.add('modal-open');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.querySelector('[data-act="close"]').focus();
    }
  }
  function render() {
    const filtered = M.filter(items, {
      query: document.getElementById('library-search').value,
      source: document.getElementById('library-source').value,
      state: document.getElementById('library-status').value,
      sort: document.getElementById('library-sort').value
    });
    for (const kind of shelves) {
      const rows = filtered.filter(item => item.kind === kind);
      const panel = document.getElementById(`p-${kind}`);
      panel.querySelector('.shelf-count').textContent = rows.length;
      const body = panel.querySelector('.pbody');
      body.innerHTML = rows.length ? rows.map(item => `<button type="button" class="row${selected === item.id ? ' selected' : ''}" data-id="${esc(item.id)}">
        <span class="title">${esc(item.title)}</span>
        <span class="meta">${esc([item.author || item.director || item.creator, item.year, M.status(item), M.rating(item)].filter(Boolean).join(' · '))}</span>
        <span class="source-tags">${esc([...new Set([item.source, ...item.imports.map(e => e.source)])].map(s => names[s]).join(' / '))}</span>
      </button>`).join('') : '<div class="empty">[ no matching entries ]</div>';
    }
    document.getElementById('library-results').textContent = `${filtered.length} / ${items.length} entries`;
    if (selected && !filtered.some(item => item.id === selected)) closeReader();
  }
  window.startLibrary = async function () {
    const paths = ['../data/library.json', '../data/imports/letterboxd.json', '../data/imports/myanimelist.json', '../data/library-links.json'];
    const results = await Promise.allSettled(paths.map(read));
    const failures = [];
    const get = (i, fallback, name) => {
      if (results[i].status === 'fulfilled') return results[i].value;
      failures.push(name); return fallback;
    };
    const local = get(0, {}, 'handwritten library');
    const snapshots = [get(1, null, 'Letterboxd snapshot'), get(2, null, 'MyAnimeList snapshot')].filter(Boolean);
    const links = get(3, [], 'entry links');
    items = M.merge(local, snapshots, links).filter(item => shelves.includes(item.kind));
    document.getElementById('library-load-status').textContent = failures.length ? `Could not load ${failures.join(', ')}. Available entries are shown; reload to retry.` : 'public records + personal notes';
    document.getElementById('library-load-status').setAttribute('role', failures.length ? 'alert' : 'status');
    document.querySelector('#p-stats .pbody').innerHTML = shelves.map(kind => `<div class="stat"><span>${labels[kind]}</span><span>${items.filter(i => i.kind === kind).length}</span></div>`).join('') + `<div class="stat"><span>in progress</span><span>${items.filter(i => M.status(i) === 'in progress').length}</span></div><div class="stat"><span>planned</span><span>${items.filter(i => M.status(i) === 'planned').length}</span></div>`;
    for (const id of ['library-search', 'library-source', 'library-status', 'library-sort']) document.getElementById(id).addEventListener(id === 'library-search' ? 'input' : 'change', render);
    document.querySelector('.grid-col-stack').addEventListener('click', event => {
      const row = event.target.closest('.row');
      if (row) detail(items.find(item => item.id === row.dataset.id), row);
    });
    const panel = document.getElementById('p-detail');
    panel.querySelector('[data-act="min"]')?.remove();
    panel.querySelector('[data-act="close"]').addEventListener('click', event => {
      event.stopImmediatePropagation(); closeReader();
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && selected) closeReader();
      if (event.key === 'Tab' && document.body.classList.contains('modal-open')) {
        const focusable = [...panel.querySelectorAll('button, a[href]')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
      }
    });
    window.addEventListener('resize', () => {
      if (!matchMedia('(max-width: 720px)').matches) {document.body.classList.remove('modal-open'); panel.removeAttribute('aria-modal'); panel.removeAttribute('role');}
    });
    render();
  };
})();
