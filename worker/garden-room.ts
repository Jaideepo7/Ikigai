import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

/** One room per garden owner. Relays movement + chat between everyone standing in that garden. */
interface Peer { id: number; name: string; character: number; x: number; y: number; dir: string; moving: boolean; typing: boolean }
type Msg =
  | { t: 'move'; x: number; y: number; dir: string; moving: boolean }
  | { t: 'chat'; text: string }
  | { t: 'typing'; on: boolean };

export class GardenRoom extends DurableObject<Env> {
  private ownerId = 0;

  async fetch(req: Request): Promise<Response> {
    const me = JSON.parse(req.headers.get('x-user') || 'null') as { id: number; name: string; character: number; ownerId: number } | null;
    if (!me) return new Response('bad', { status: 400 });
    this.ownerId = me.ownerId;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const peer: Peer = { id: me.id, name: me.name, character: me.character, x: 0, y: 0, dir: 'down', moving: false, typing: false };
    this.ctx.acceptWebSocket(server, [String(me.id)]);
    server.serializeAttachment(peer);
    server.send(JSON.stringify({ t: 'roster', you: me.id, peers: this.peers().filter((p) => p.id !== me.id) }));
    this.broadcast({ t: 'join', peer }, server);
    await this.presence(me.id, `garden:${me.ownerId}`);
    await this.ctx.storage.setAlarm(Date.now() + 45_000);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let m: Msg; try { m = JSON.parse(raw); } catch { return; }
    const peer = ws.deserializeAttachment() as Peer;
    if (m.t === 'move' && Number.isFinite(m.x) && Number.isFinite(m.y)) {
      Object.assign(peer, { x: m.x, y: m.y, dir: String(m.dir).slice(0, 5), moving: !!m.moving });
      ws.serializeAttachment(peer);
      this.broadcast({ t: 'move', id: peer.id, x: peer.x, y: peer.y, dir: peer.dir, moving: peer.moving }, ws);
    } else if (m.t === 'chat' && typeof m.text === 'string') {
      const text = m.text.trim().slice(0, 140);
      if (!text) return;
      peer.typing = false; ws.serializeAttachment(peer);
      this.broadcast({ t: 'chat', id: peer.id, text });
    } else if (m.t === 'typing') {
      peer.typing = !!m.on; ws.serializeAttachment(peer);
      this.broadcast({ t: 'typing', id: peer.id, on: peer.typing }, ws);
    }
  }
  async webSocketClose(ws: WebSocket) { await this.drop(ws); }
  async webSocketError(ws: WebSocket) { await this.drop(ws); }

  /** Keep last_seen fresh for everyone still in the room so friends lists show them online. */
  async alarm() {
    const ids = [...new Set(this.peers().map((p) => p.id))];
    if (!ids.length) return;
    await this.env.DB.prepare(`UPDATE users SET last_seen=? WHERE id IN (${ids.map(() => '?').join(',')})`).bind(Date.now(), ...ids).run();
    await this.ctx.storage.setAlarm(Date.now() + 45_000);
  }

  private async drop(ws: WebSocket) {
    const peer = ws.deserializeAttachment() as Peer | null;
    try { ws.close(); } catch { /* already closed */ }
    if (!peer) return;
    this.broadcast({ t: 'leave', id: peer.id });
    if (!this.peers().some((p) => p.id === peer.id)) await this.presence(peer.id, null);
  }
  private peers(): Peer[] { return this.ctx.getWebSockets().map((s) => s.deserializeAttachment() as Peer).filter(Boolean); }
  private broadcast(msg: unknown, except?: WebSocket) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) { try { ws.send(s); } catch { /* closing */ } }
  }
  private async presence(userId: number, location: string | null) {
    await this.env.DB.prepare('UPDATE users SET location=?, last_seen=? WHERE id=?').bind(location, Date.now(), userId).run();
  }
}
