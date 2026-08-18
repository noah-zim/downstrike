// Real-time strike feed from the Blitzortung.org community network.
// Protocol: connect, send {"a":111}, receive LZW-compressed JSON, one strike per message.

const SERVERS = [
  'wss://ws1.blitzortung.org/',
  'wss://ws7.blitzortung.org/',
  'wss://ws8.blitzortung.org/',
];

function lzwDecode(data) {
  const dict = {};
  const chars = data.split('');
  let currChar = chars[0];
  let oldPhrase = currChar;
  const out = [currChar];
  let code = 256;
  let phrase;
  for (let i = 1; i < chars.length; i++) {
    const currCode = chars[i].charCodeAt(0);
    if (currCode < 256) {
      phrase = chars[i];
    } else {
      phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
    }
    out.push(phrase);
    currChar = phrase.charAt(0);
    dict[code] = oldPhrase + currChar;
    code++;
    oldPhrase = phrase;
  }
  return out.join('');
}

export class LightningFeed {
  constructor({ onStrike, onStatus }) {
    this.onStrike = onStrike;
    this.onStatus = onStatus;
    this.serverIdx = 0;
    this.ws = null;
    this.received = 0;
    this.connected = false;
    this._closedByUs = false;
  }

  start() {
    this._connect();
  }

  _connect() {
    const url = SERVERS[this.serverIdx % SERVERS.length];
    this.onStatus({ connected: false, text: `connecting ${new URL(url).host}…` });
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this._failover();
      return;
    }
    this.ws = ws;
    const failTimer = setTimeout(() => { try { ws.close(); } catch (e) {} }, 8000);

    ws.onopen = () => {
      clearTimeout(failTimer);
      this.connected = true;
      this.onStatus({ connected: true, text: `live · ${new URL(url).host}` });
      ws.send(JSON.stringify({ a: 111 }));
    };

    ws.onmessage = (ev) => {
      let strike;
      try {
        strike = JSON.parse(lzwDecode(ev.data));
      } catch (e) {
        return;
      }
      if (typeof strike.lat !== 'number' || typeof strike.lon !== 'number') return;
      this.received++;
      const now = Date.now();
      let t = strike.time / 1e6; // ns -> ms
      if (!isFinite(t) || Math.abs(now - t) > 10 * 60 * 1000) t = now;
      this.onStrike({ lat: strike.lat, lon: strike.lon, t, tArr: now });
    };

    ws.onclose = () => {
      clearTimeout(failTimer);
      this.connected = false;
      if (this._closedByUs) return;
      this.onStatus({ connected: false, text: 'reconnecting…' });
      this._failover();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  _failover() {
    this.serverIdx++;
    setTimeout(() => this._connect(), 1500);
  }

  stop() {
    this._closedByUs = true;
    try { this.ws && this.ws.close(); } catch (e) {}
  }
}
