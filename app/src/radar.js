// RainViewer radar overlay (toggleable raster layer).
const META_URL = 'https://api.rainviewer.com/public/weather-maps.json';

export class Radar {
  constructor(map) {
    this.map = map;
    this.enabled = false;
    this.timer = null;
    this.currentPath = null;
  }

  async setEnabled(on) {
    this.enabled = on;
    if (on) {
      await this._refresh();
      clearInterval(this.timer);
      if (!this.enabled) return; // toggled off again while the refresh was in flight
      this.timer = setInterval(() => this._refresh().catch(() => {}), 5 * 60 * 1000);
    } else {
      clearInterval(this.timer);
      this.timer = null;
      this.currentPath = null;
      this._removeLayer();
    }
  }

  async _refresh() {
    const res = await fetch(META_URL);
    if (!res.ok) throw new Error('rainviewer ' + res.status);
    const j = await res.json();
    const frames = j.radar && j.radar.past;
    if (!frames || !frames.length) return;
    const latest = frames[frames.length - 1];
    if (!this.enabled) return; // don't record state for a layer we won't add
    if (latest.path === this.currentPath) return;
    this.currentPath = latest.path;
    const tiles = `${j.host}${latest.path}/512/{z}/{x}/{y}/2/1_1.png`;
    this._removeLayer();
    this.map.addSource('rainviewer', {
      type: 'raster',
      tiles: [tiles],
      tileSize: 256,
      maxzoom: 7, // free RainViewer tiles stop at z7; overzoom beyond
      attribution: '<a href="https://rainviewer.com">RainViewer</a>',
    });
    this.map.addLayer({
      id: 'rainviewer',
      type: 'raster',
      source: 'rainviewer',
      paint: { 'raster-opacity': 0.55 },
    });
  }

  _removeLayer() {
    if (this.map.getLayer('rainviewer')) this.map.removeLayer('rainviewer');
    if (this.map.getSource('rainviewer')) this.map.removeSource('rainviewer');
  }
}
