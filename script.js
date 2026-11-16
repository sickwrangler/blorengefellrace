document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-iframe').forEach((frame) => {
    frame.style.height = window.matchMedia('(max-width: 47.99rem)').matches ? '4.5rem' : '5.25rem';
  });

  const openingMessages = document.querySelectorAll('[data-registration-opening-message]');
  if (openingMessages.length) {
    Promise.all([
      import('./registration/runner-access.mjs'),
      fetch('/api/v2/registration/status', { cache: 'no-store', headers: { Accept: 'application/json' } })
    ]).then(async ([{ publicEntryState }, response]) => {
      if (!response.ok) return;
      const entries = {
        'pre-opening': { message: 'Entries are not open yet.' },
        open: { message: 'Entries are open.', action: 'Enter here' },
        full: {
          message: 'Entries are full. Join the waiting list to be offered a place if one becomes available.',
          action: 'Join the waiting list'
        },
        paused: { message: 'Entries and waiting-list sign-ups are temporarily paused.' },
        closed: { message: 'Entries have closed.' }
      }[publicEntryState(await response.json())];
      if (!entries) return;
      openingMessages.forEach((node) => { node.textContent = entries.message; });
      const action = document.querySelector('[data-registration-entry-action]');
      if (entries.action && action) action.textContent = entries.action;
      if (!entries.action) action?.remove();
    }).catch(() => {});
  }
});

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.type !== 'blorenge-nav-height') return;
  const height = Number(event.data.height);
  if (!Number.isFinite(height) || height < 60 || height > 360) return;
  document.querySelectorAll('.nav-iframe').forEach((frame) => { frame.style.height = `${height}px`; });
});
