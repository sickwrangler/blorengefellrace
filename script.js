document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-iframe').forEach((frame) => {
    frame.style.height = window.matchMedia('(max-width: 47.99rem)').matches ? '4.5rem' : '5.25rem';
  });

  const openingMessages = document.querySelectorAll('[data-registration-opening-message]');
  if (openingMessages.length) {
    fetch('/api/v2/registration/status', { headers: { Accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Registration status unavailable')))
      .then((status) => {
        const message = status.operationalState === 'OPEN' ? 'Entries are open.' : 'Entries are not yet open.';
        openingMessages.forEach((node) => { node.textContent = message; });
      })
      .catch(() => {});
  }
});

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.type !== 'blorenge-nav-height') return;
  const height = Number(event.data.height);
  if (!Number.isFinite(height) || height < 60 || height > 360) return;
  document.querySelectorAll('.nav-iframe').forEach((frame) => { frame.style.height = `${height}px`; });
});
