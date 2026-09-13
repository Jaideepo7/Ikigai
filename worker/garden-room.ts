import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

/**
 * One room per garden owner. Relays movement, chat, typing and emotes between everyone standing in that garden.
 * Visitors join as "pending" while the owner is present: the owner gets a knock and must accept or decline.
 * If the owner is not in the garden, visitors are let in straight away.
 * The owner's room also carries their "hub" sockets: a lightweight connection every session keeps open so
 * friend requests / acceptances arrive instantly (POST /notify from the Worker). Hub sockets are never peers.
 */
interface Peer { id: number; name: string; character: number; x: number; y: number; dir: string; moving: boolean; typing: boolean; pending: boolean; hub?: boolean }
type Msg =
  | { t: 'move'; x: number; y: number; dir: string; moving: boolean }
  | { t: 'chat'; text: string }
  | { t: 'typing'; on: boolean }
  | { t: 'emote'; kind: string }
  | { t: 'visit'; id: number; accept: boolean };

export class GardenRoom extends DurableObject<Env> {
  private ownerId = 0;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/notify') {
      const body = await req.text();
      for (const s of this.ctx.getWebSockets('hub')) { try { s.send(body); } catch { /* closing */ } }
      return new Response('ok');
    }
    const me = JSON.parse(req.headers.get('x-user') || 'null') as { id: number; name: string; character: number; ownerId: number; hub?: boolean } | null;
    if (!me) return new Response('bad', { status: 400 });
    this.ownerId = me.ownerId;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (me.hub) {
      this.ctx.acceptWebSocket(server, ['hub']);
      server.serializeAttachment({ id: me.id, hub: true, pending: true } as Peer);
      return new Response(null, { status: 101, webSocket: client });
    }
    const ownerHere = this.peers().some((p) => p.id === this.ownerId && !p.pending);
    const pending = me.id !== this.ownerId && ownerHere;
    const peer: Peer = { id: me.id, name: me.name, character: me.character, x: 0, y: 0, dir: 'down', moving: false, typing: false, pending };
    this.ctx.acceptWebSocket(server, [String(me.id)]);
    server.serializeAttachment(peer);
    if (pending) {
      server.send(JSON.stringify({ t: 'knocking' }));
      this.sendTo(this.ownerId, { t: 'knock', id: me.id, name: me.name, character: me.character });
    } else {
      this.admit(server, peer);
    }
    await this.ctx.storage.setAlarm(Date.now() + 45_000);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Let a peer into the room: roster for them, join for everyone else, presence in D1. */
  private admit(ws: WebSocket, peer: Peer) {
    peer.pending = false; ws.serializeAttachment(peer);
    ws.send(JSON.stringify({ t: 'roster', you: peer.id, peers: this.peers().filter((p) => p.id !== peer.id && !p.pending) }));
    this.broadcast({ t: 'join', peer }, ws);
    this.ctx.waitUntil(this.presence(peer.id, `garden:${this.ownerId}`));
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let m: Msg; try { m = JSON.parse(raw); } catch { return; }
    const peer = ws.deserializeAttachment() as Peer;
    if (peer.hub) return;
    if (m.t === 'visit' && peer.id === this.ownerId) {
      for (const s of this.ctx.getWebSockets(String(m.id))) {
        const p = s.deserializeAttachment() as Peer;
        if (!p?.pending) continue;
        if (m.accept) this.admit(s, p);
        else { try { s.send(JSON.stringify({ t: 'denied' })); s.close(1000, 'denied'); } catch { /* gone */ } }
      }
      return;
    }
    if (peer.pending) return;
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
    } else if (m.t === 'emote') {
      this.broadcast({ t: 'emote', id: peer.id, kind: String(m.kind).slice(0, 10) }, ws);
    }
  }
  async webSocketClose(ws: WebSocket) { await this.drop(ws); }
  async webSocketError(ws: WebSocket) { await this.drop(ws); }

  /** Keep last_seen fresh for everyone still in the room so friends lists show them online. */
  async alarm() {
    const ids = [...new Set(this.peers().filter((p) => !p.pending).map((p) => p.id))];
    if (!ids.length) return;
    await this.env.DB.prepare(`UPDATE users SET last_seen=? WHERE id IN (${ids.map(() => '?').join(',')})`).bind(Date.now(), ...ids).run();
    await this.ctx.storage.setAlarm(Date.now() + 45_000);
  }

  private async drop(ws: WebSocket) {
    const peer = ws.deserializeAttachment() as Peer | null;
    try { ws.close(); } catch { /* already closed */ }
    if (!peer || peer.hub) return;
    if (!peer.pending) this.broadcast({ t: 'leave', id: peer.id });
    if (!this.peers().some((p) => p.id === peer.id && !p.pending)) await this.presence(peer.id, null);
    // owner left: anyone still knocking gets in
    if (peer.id === this.ownerId) for (const s of this.ctx.getWebSockets()) { const p = s.deserializeAttachment() as Peer; if (p?.pending && !p.hub) this.admit(s, p); }
  }
  private peers(): Peer[] { return this.ctx.getWebSockets().map((s) => s.deserializeAttachment() as Peer).filter((p) => p && !p.hub); }
  private sendTo(id: number, msg: unknown) { for (const s of this.ctx.getWebSockets(String(id))) { try { s.send(JSON.stringify(msg)); } catch { /* closing */ } } }
  private broadcast(msg: unknown, except?: WebSocket) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { const p = ws.deserializeAttachment() as Peer; if (ws !== except && p && !p.pending && !p.hub) { try { ws.send(s); } catch { /* closing */ } } }
  }
  private async presence(userId: number, location: string | null) {
    await this.env.DB.prepare('UPDATE users SET location=?, last_seen=? WHERE id=?').bind(location, Date.now(), userId).run();
  }
}
