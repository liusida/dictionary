self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('fetch', function(event) {
  // Just pass-through for now
  return;
});
