document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-iframe').forEach((frame) => {
    frame.style.height = window.matchMedia('(max-width: 47.99rem)').matches ? '4.5rem' : '5.25rem';
  });
});

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.type !== 'blorenge-nav-height') return;
  const height = Number(event.data.height);
  if (!Number.isFinite(height) || height < 60 || height > 360) return;
  document.querySelectorAll('.nav-iframe').forEach((frame) => { frame.style.height = `${height}px`; });
});
