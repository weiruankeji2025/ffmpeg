/**
 * COI Service Worker for 威软FFmpeg
 *
 * Injects Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy
 * headers into every response, enabling SharedArrayBuffer on any HTTP
 * server — required by FFmpeg.wasm v0.12+.
 *
 * Based on https://github.com/gzuidhof/coi-serviceworker (MIT)
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function handleFetch(request) {
  // Safari quirk: avoid intercepting opaque-only-if-cached requests
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  let response;
  try {
    response = await fetch(request);
  } catch (e) {
    // Network failure (e.g. offline) — return a proper error response
    // instead of re-throwing, which would crash the service worker.
    return Response.error();
  }

  // Don't tamper with opaque (cross-origin no-cors) responses
  if (!response || response.status === 0 || response.type === 'opaque') {
    return response;
  }

  const headers = new Headers(response.headers);
  // Same-origin isolation: required for SharedArrayBuffer
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // credentialless: allows loading cross-origin resources without CORS
  // (Chrome 96+, Firefox 119+). Fallback: change to 'require-corp' for stricter compat.
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  // Allow cross-origin resources to be embedded
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (e) => {
  // Only intercept same-origin requests to inject isolation headers.
  // Cross-origin requests (CDN scripts, WASM, etc.) are handled by the
  // browser normally — intercepting them risks CORS failures in the SW.
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(handleFetch(e.request));
});
