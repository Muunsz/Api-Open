chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'API_OPEN_EXT_FETCH') return false;

  const { url, method, headers, body } = message.payload;
  const startedAt = performance.now();

  fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  })
    .then(async (res) => {
      const text = await res.text();
      const resHeaders = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });
      sendResponse({
        ok: true,
        result: {
          statusCode: res.status,
          statusText: res.statusText,
          headers: resHeaders,
          body: text,
          isBase64: false,
          sizeBytes: new TextEncoder().encode(text).length,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });
    })
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err && err.message ? err.message : 'Extension fetch failed',
      });
    });

  return true;
});
