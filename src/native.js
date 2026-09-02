// Bridge to the iOS app shell. On the plain website this is a no-op wrapper
// around the browser's own geolocation API.
export const isApp = !!(window.webkit && window.webkit.messageHandlers &&
  window.webkit.messageHandlers.downstrike);

let pendingLocation = null;

export function getPosition() {
  if (isApp) {
    return new Promise((resolve, reject) => {
      pendingLocation = { resolve, reject };
      window.webkit.messageHandlers.downstrike.postMessage({ type: 'getLocation' });
      setTimeout(() => {
        if (pendingLocation) {
          pendingLocation.reject(new Error('timeout'));
          pendingLocation = null;
        }
      }, 15000);
    });
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('geolocation unavailable')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
}

// Called by the native shell with the result of a getLocation request.
window._nativeLocation = (lat, lon, errMsg) => {
  if (!pendingLocation) return;
  const p = pendingLocation;
  pendingLocation = null;
  if (typeof lat === 'number' && typeof lon === 'number') p.resolve({ lat, lon });
  else p.reject(new Error(errMsg || 'location unavailable'));
};
