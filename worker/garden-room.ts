import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

/**
 * One room per owner domain (house + garden). Relays move / chat / typing / emotes.
 * Visitors always knock while the owner is online (domain peer OR hub socket).
 * House ↔ garden keeps one client socket open, so no re-knock mid-visit.
 * Hub sockets carry friend + doorbell notifications and are never movement peers.
 */
interface Peer { id: number; name: string; character: number; x: number; y: number; dir: string; moving: boolean; typing: boolean; pending: boolean; area?: string; hub?: boolean }
type Msg =
  | { t: 'move'; x: number; y: number; dir: string; moving: boolean; area?: string }
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
    // Owner counts as home if they have a domain peer OR their always-on hub is connected.
    const ownerOnline = this.ownerSockets().length > 0;
    const pending = me.id !== this.ownerId && ownerOnline;
    const peer: Peer = { id: me.id, name: me.name, character: me.character, x: 0, y: 0, dir: 'down', moving: false, typing: false, pending, area: undefined };
    this.ctx.acceptWebSocket(server, [String(me.id)]);
    server.serializeAttachment(peer);
    if (pending) {
      server.send(JSON.stringify({ t: 'knocking' }));
      this.notifyOwner({ t: 'knock', id: me.id, name: me.name, character: me.character });
    } else if (me.id !== this.ownerId && !ownerOnline) {
      // Friend is offline — don't wander an empty house; tell the visitor to leave.
      server.send(JSON.stringify({ t: 'denied' }));
      server.close(1000, 'away');
    } else {
      await this.admit(server, peer);
    }
    await this.ctx.storage.setAlarm(Date.now() + 45_000);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Let a peer into the domain: roster for them, join for everyone else. */
  private async admit(ws: WebSocket, peer: Peer) {
    peer.pending = false; ws.serializeAttachment(peer);
    ws.send(JSON.stringify({ t: 'roster', you: peer.id, peers: this.peers().filter((p) => p.id !== peer.id && !p.pending) }));
    this.broadcast({ t: 'join', peer }, ws);
    this.ctx.waitUntil(this.presence(peer.id, `garden:${this.ownerId}`));
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let m: Msg; try { m = JSON.parse(raw); } catch { return; }
    const peer = ws.deserializeAttachment() as Peer;
    // Hub may only accept/deny visitors (doorbell). Domain peers handle everything else.
    if (peer.hub) {
      if (m.t === 'visit' && peer.id === this.ownerId) this.handleVisit(m);
      return;
    }
    if (m.t === 'visit' && peer.id === this.ownerId) {
      this.handleVisit(m);
      return;
    }
    if (peer.pending) return;
    if (m.t === 'move' && Number.isFinite(m.x) && Number.isFinite(m.y)) {
      Object.assign(peer, { x: m.x, y: m.y, dir: String(m.dir).slice(0, 5), moving: !!m.moving, area: m.area === 'house' ? 'house' : 'garden' });
      ws.serializeAttachment(peer);
      this.broadcast({ t: 'move', id: peer.id, x: peer.x, y: peer.y, dir: peer.dir, moving: peer.moving, area: peer.area }, ws);
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

  async alarm() {
    const ids = [...new Set(this.peers().filter((p) => !p.pending).map((p) => p.id))];
    if (!ids.length) return;
    await this.env.DB.prepare(`UPDATE users SET last_seen=? WHERE id IN (${ids.map(() => '?').join(',')})`).bind(Date.now(), ...ids).run();
    await this.ctx.storage.setAlarm(Date.now() + 45_000);
  }

  private handleVisit(m: { id: number; accept: boolean }) {
    for (const s of this.ctx.getWebSockets(String(m.id))) {
      const p = s.deserializeAttachment() as Peer;
      if (!p?.pending || p.hub) continue;
      if (m.accept) this.ctx.waitUntil(this.admit(s, p));
      else { try { s.send(JSON.stringify({ t: 'denied' })); s.close(1000, 'denied'); } catch { /* gone */ } }
    }
  }

  private async drop(ws: WebSocket) {
    const peer = ws.deserializeAttachment() as Peer | null;
    try { ws.close(); } catch { /* already closed */ }
    if (!peer || peer.hub) return;
    if (!peer.pending) this.broadcast({ t: 'leave', id: peer.id });
    if (!peer.pending && !this.peers().some((p) => p.id === peer.id)) await this.presence(peer.id, null);
    // Owner left the domain entirely (no domain peer left): auto-let anyone still knocking in.
    // Hub alone still counts as "home" for NEW knocks, but pending visitors shouldn't wait forever if the owner closed the tab mid-knock — hub close is separate.
    if (peer.id === this.ownerId && !this.peers().some((p) => p.id === this.ownerId && !p.pending)) {
      if (!this.ownerSockets().length) {
        for (const s of this.ctx.getWebSockets()) {
          const p = s.deserializeAttachment() as Peer;
          if (p?.pending && !p.hub) this.ctx.waitUntil(this.admit(s, p));
        }
      }
    }
  }
  private peers(): Peer[] { return this.ctx.getWebSockets().map((s) => s.deserializeAttachment() as Peer).filter((p) => p && !p.hub); }
  private ownerSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((s) => {
      const p = s.deserializeAttachment() as Peer;
      return p && p.id === this.ownerId;
    });
  }
  private notifyOwner(msg: unknown) {
    // Doorbell goes only to the hub so the owner gets one popup (not one per socket).
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets('hub')) { try { ws.send(s); } catch { /* closing */ } }
  }
  private broadcast(msg: unknown, except?: WebSocket) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { const p = ws.deserializeAttachment() as Peer; if (ws !== except && p && !p.pending && !p.hub) { try { ws.send(s); } catch { /* closing */ } } }
  }
  private async presence(userId: number, location: string | null) {
    await this.env.DB.prepare('UPDATE users SET location=?, last_seen=? WHERE id=?').bind(location, Date.now(), userId).run();
  }
}
