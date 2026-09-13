import { bus, emit, toast } from '../state';
import { sfx } from '../ui/audio';

export type KnockEvent = { id: number; name: string; character: number };

/** Always-on notification socket: friend events + doorbell when someone visits your home. */
let ws: WebSocket | undefined, closed = false, delay = 1000;
export function connectHub() {
  if (ws) return;
  closed = false;
  open();
}
export function hubVisit(id: number, accept: boolean) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'visit', id, accept }));
}
function open() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/hub`);
  ws.onopen = () => { delay = 1000; };
  ws.onmessage = (ev) => {
    let m: { t: string; kind?: string; from?: string; id?: number; name?: string; character?: number };
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'friend') {
      if (m.kind === 'request') { toast(`${m.from} sent you a friend request`, 'reward'); sfx.chime(); }
      else if (m.kind === 'accepted') { toast(`${m.from} accepted your friend request`, 'reward'); sfx.chime(); }
      else if (m.kind === 'removed') toast(`${m.from} removed you as a friend`);
      emit('friends');
      return;
    }
    if (m.t === 'knock' && m.id != null && m.name != null) {
      bus.dispatchEvent(new CustomEvent<KnockEvent>('knock', { detail: { id: m.id, name: m.name, character: m.character ?? 0 } }));
    }
  };
  ws.onclose = () => { ws = undefined; if (!closed) { setTimeout(open, delay); delay = Math.min(15_000, delay * 2); } };
}
export function closeHub() { closed = true; ws?.close(); ws = undefined; }
