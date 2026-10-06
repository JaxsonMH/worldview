// Worldview: small wrappers around the news service API (/api/news/*).
// Shared by the Reader and, in Phase 2, the globe's My News layer.

async function call(method, path, body, { raw = false } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.body = raw ? body : JSON.stringify(body);
    init.headers['Content-Type'] = raw ? 'text/xml' : 'application/json';
  }
  const res = await fetch(`/api/news${path}`, init);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d.msg).join('; ')
      : data.detail;
    throw new Error(detail || data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const newsApi = {
  health: () => call('GET', '/health'),
  search: (query) => call('POST', '/articles/search', query),
  article: (id) => call('GET', `/articles/${id}`),
  patchArticle: (id, patch) => call('PATCH', `/articles/${id}`, patch),
  setTopics: (id, topics) => call('PUT', `/articles/${id}/topics`, { topics }),
  markRead: (query) => call('POST', '/articles/mark-read', query),
  facets: () => call('GET', '/facets'),
  topics: () => call('GET', '/topics'),
  anchors: () => call('GET', '/anchors'),
  sources: () => call('GET', '/sources'),
  nearby: (lat, lon, km) =>
    call('GET', `/nearby?lat=${lat}&lon=${lon}&km=${km}`),
  placeNearest: (lat, lon) =>
    call('GET', `/places/nearest?lat=${lat}&lon=${lon}`),
  placeSearch: (q) => call('GET', `/places/search?q=${encodeURIComponent(q)}`),
  feeds: () => call('GET', '/feeds'),
  addFeed: (feed) => call('POST', '/feeds', feed),
  patchFeed: (id, patch) => call('PATCH', `/feeds/${id}`, patch),
  importOpml: (text) => call('POST', '/feeds/import', text, { raw: true }),
  fetchNow: () => call('POST', '/fetch'),
  savedSearches: () => call('GET', '/saved-searches'),
  createSaved: (body) => call('POST', '/saved-searches', body),
  updateSaved: (id, body) => call('PUT', `/saved-searches/${id}`, body),
  deleteSaved: (id) => call('DELETE', `/saved-searches/${id}`),
};
