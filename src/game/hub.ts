import { emit, toast } from '../state';
import { sfx } from '../ui/audio';

/** Always-on notification socket: friend requests / acceptances show as toasts the moment they happen. */
let ws: WebSocket | undefined, closed = false, delay = 1000;
export function connectHub() {
  if (ws) return;
  closed = false;
  open();
}
function open() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/hub`);
  ws.onopen = () => { delay = 1000; };
  ws.onmessage = (ev) => {
    let m: { t: string; kind: string; from: string }; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t !== 'friend') return;
    if (m.kind === 'request') { toast(`${m.from} sent you a friend request`, 'reward'); sfx.chime(); }
    else if (m.kind === 'accepted') { toast(`${m.from} accepted your friend request`, 'reward'); sfx.chime(); }
    else if (m.kind === 'removed') toast(`${m.from} removed you as a friend`);
    emit('friends');
  };
  ws.onclose = () => { ws = undefined; if (!closed) { setTimeout(open, delay); delay = Math.min(15_000, delay * 2); } };
}
export function closeHub() { closed = true; ws?.close(); ws = undefined; }
