window.__API_OPEN_EXTENSION__ = true;

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.type !== 'API_OPEN_EXT_REQUEST') return;

  const { requestId, payload } = event.data;
  chrome.runtime.sendMessage(
    { type: 'API_OPEN_EXT_FETCH', payload },
    (response) => {
      window.postMessage(
        {
          type: 'API_OPEN_EXT_RESPONSE',
          requestId,
          response,
        },
        '*',
      );
    },
  );
});
