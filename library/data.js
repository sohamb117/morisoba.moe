/* Shared by the static page and Node tests. No runtime dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LibraryData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const kinds = ['books', 'films', 'shows', 'manga'];
  const status = item => item.status || (item.finished ? 'completed' : item.started ? 'in progress' : 'unrecorded');
  const rating = item => Number.isFinite(item.rating) ? `${item.rating}/${item.ratingMax || 5}` : 'unrated';
  function merge(local, snapshots, links) {
    const items = kinds.flatMap(kind => (local[kind] || []).map((item, i) => ({
      ...item, id: `local:${kind}:${i}`, kind, source: 'local', imports: [], ratingMax: 5
    })));
    const byId = new Map();
    const groups = new Map();
    for (const group of links) {
      const manual = group.local && items.find(item => item.kind === group.local.kind && item.title === group.local.title);
      for (const id of group.ids) {
        groups.set(id, group.ids[0]);
        if (manual) byId.set(id, manual);
      }
    }
    const seen = new Set();
    for (const snapshot of snapshots) for (const entry of snapshot.entries) {
      if (seen.has(entry.id) || !kinds.includes(entry.kind)) continue;
      seen.add(entry.id);
      const groupId = groups.get(entry.id) || entry.id;
      let item = byId.get(entry.id) || byId.get(groupId);
      if (!item) {
        item = {...entry, id: groupId, imports: []};
        items.push(item);
      }
      byId.set(groupId, item);
      byId.set(entry.id, item);
      item.imports.push(entry);
      if (item.source !== 'local' && entry.status === 'completed') item.status = 'completed';
    }
    return items;
  }
  function filter(items, {query = '', source = 'all', state = 'all', sort = 'rating'} = {}) {
    const q = query.trim().toLocaleLowerCase();
    const result = items.filter(item =>
      (source === 'all' || item.source === source || item.imports.some(e => e.source === source)) &&
      (state === 'all' || status(item) === state) &&
      (!q || [item.title, item.author, item.director, item.creator, ...item.imports.flatMap(e => [e.title, e.alternateTitle])]
        .filter(Boolean).some(value => value.toLocaleLowerCase().includes(q)))
    );
    return result.sort((a, b) => {
      if (sort === 'rating') {
        const diff = (b.rating == null ? -1 : b.rating / (b.ratingMax || 5)) - (a.rating == null ? -1 : a.rating / (a.ratingMax || 5));
        if (diff) return diff;
      }
      return a.title.localeCompare(b.title);
    });
  }
  function validSnapshot(value) {
    return value?.schemaVersion === 1 && ['letterboxd', 'myanimelist'].includes(value.source) &&
      typeof value.username === 'string' && typeof value.syncedAt === 'string' && !Number.isNaN(Date.parse(value.syncedAt)) &&
      value.counts && typeof value.counts === 'object' && Array.isArray(value.entries) &&
      value.entries.every(e => e && typeof e.id === 'string' && typeof e.title === 'string' &&
        e.source === value.source && kinds.includes(e.kind) && ['completed','in progress','planned','on hold','dropped'].includes(e.status) &&
        [5,10].includes(e.ratingMax) && (e.rating === null || (Number.isFinite(e.rating) && e.rating > 0 && e.rating <= e.ratingMax)) &&
        (!e.progress || (Number.isInteger(e.progress.value) && e.progress.value >= 0 &&
          (e.progress.total === null || (Number.isInteger(e.progress.total) && e.progress.total >= 0)))));
  }
  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['letterboxd.com', 'myanimelist.net'].includes(url.hostname) && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  return {kinds, status, rating, merge, filter, safeUrl, validSnapshot};
});
