/** WebSocket client for one owner's house+garden domain. Movement is throttled to ~12 updates/s and only sent on change. */
export interface PeerState { id: number; name: string; character: number; x: number; y: number; dir: string; moving: boolean; typing?: boolean; area?: 'house' | 'garden' }
type Handler = {
  roster: (you: number, peers: PeerState[]) => void; join: (p: PeerState) => void; leave: (id: number) => void;
  move: (m: { id: number; x: number; y: number; dir: string; moving: boolean; area?: 'house' | 'garden' }) => void; chat: (id: number, text: string) => void; typing: (id: number, on: boolean) => void;
  emote: (id: number, kind: string) => void; knocking: () => void; knock: (p: { id: number; name: string; character: number }) => void; denied: () => void;
};

export class Net {
  private ws?: WebSocket;
  private last = '';
  private lastSent = 0;
  private closed = false;
  constructor(private ownerId: number, private h: Handler) { this.connect(); }
  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws/garden/${this.ownerId}`);
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'roster') this.h.roster(m.you, m.peers);
      else if (m.t === 'join') this.h.join(m.peer);
      else if (m.t === 'leave') this.h.leave(m.id);
      else if (m.t === 'move') this.h.move(m);
      else if (m.t === 'chat') this.h.chat(m.id, m.text);
      else if (m.t === 'typing') this.h.typing(m.id, m.on);
      else if (m.t === 'emote') this.h.emote(m.id, m.kind);
      else if (m.t === 'knocking') this.h.knocking();
      else if (m.t === 'knock') this.h.knock(m);
      else if (m.t === 'denied') { this.closed = true; this.h.denied(); }
    };
    this.ws.onclose = () => { if (!this.closed) setTimeout(() => this.connect(), 2000); };
  }
  move(x: number, y: number, dir: string, moving: boolean, area: 'house' | 'garden' = 'garden') {
    const now = performance.now();
    const key = `${Math.round(x)},${Math.round(y)},${dir},${moving},${area}`;
    if (key === this.last || now - this.lastSent < 80) return;
    this.last = key; this.lastSent = now;
    this.send({ t: 'move', x: Math.round(x), y: Math.round(y), dir, moving, area });
  }
  /** Clear the move dedupe so the next update always goes out (e.g. after House ↔ Garden). */
  resetMoveThrottle() { this.last = ''; this.lastSent = 0; }
  chat(text: string) { this.send({ t: 'chat', text }); }
  typing(on: boolean) { this.send({ t: 'typing', on }); }
  emote(kind: string) { this.send({ t: 'emote', kind }); }
  visit(id: number, accept: boolean) { this.send({ t: 'visit', id, accept }); }
  private send(o: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)); }
  close() { this.closed = true; this.ws?.close(); }
}
