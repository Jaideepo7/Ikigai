/** Shared realtime socket for one owner's house+garden domain. Survives House ↔ Garden scene switches. */
import { Net, type PeerState } from './net';

export type DomainArea = 'house' | 'garden';
export type DomainHandlers = {
  roster: (you: number, peers: PeerState[]) => void;
  join: (p: PeerState) => void;
  leave: (id: number) => void;
  move: (m: { id: number; x: number; y: number; dir: string; moving: boolean; area?: DomainArea }) => void;
  chat: (id: number, text: string) => void;
  typing: (id: number, on: boolean) => void;
  emote: (id: number, kind: string) => void;
  knocking: () => void;
  knock: (p: { id: number; name: string; character: number }) => void;
  denied: () => void;
};

type Session = {
  ownerId: number;
  net: Net;
  handlers: DomainHandlers;
  area: DomainArea;
  you: number;
  peers: Map<number, PeerState>;
};

let session: Session | null = null;

export function domainOwnerId() { return session?.ownerId ?? null; }
export function domainArea() { return session?.area ?? null; }
export function domainNet() { return session?.net ?? null; }
export function domainPeer(id: number) { return session?.peers.get(id); }

/** Attach this scene's handlers to the domain socket (creates it if needed). Replays roster so peers stay visible across House ↔ Garden. */
export function attachDomain(ownerId: number, area: DomainArea, handlers: DomainHandlers): Net {
  if (session && session.ownerId === ownerId) {
    session.handlers = handlers;
    session.area = area;
    session.net.resetMoveThrottle();
    handlers.roster(session.you, [...session.peers.values()]);
    return session.net;
  }
  detachDomain();
  const peers = new Map<number, PeerState>();
  let you = 0;
  const proxy: DomainHandlers = {
    roster: (y, list) => {
      you = y;
      peers.clear();
      for (const p of list) peers.set(p.id, { ...p });
      if (session) session.you = y;
      session?.handlers.roster(y, list);
    },
    join: (p) => { peers.set(p.id, { ...p }); session?.handlers.join(p); },
    leave: (id) => { peers.delete(id); session?.handlers.leave(id); },
    move: (m) => {
      const prev = peers.get(m.id);
      if (prev) peers.set(m.id, { ...prev, x: m.x, y: m.y, dir: m.dir, moving: m.moving, area: m.area ?? prev.area });
      else peers.set(m.id, { id: m.id, name: 'friend', character: 0, x: m.x, y: m.y, dir: m.dir, moving: m.moving, area: m.area });
      session?.handlers.move(m);
    },
    chat: (id, text) => session?.handlers.chat(id, text),
    typing: (id, on) => session?.handlers.typing(id, on),
    emote: (id, kind) => session?.handlers.emote(id, kind),
    knocking: () => session?.handlers.knocking(),
    knock: (p) => session?.handlers.knock(p),
    denied: () => session?.handlers.denied(),
  };
  const net = new Net(ownerId, proxy);
  session = { ownerId, net, handlers, area, you, peers };
  return net;
}

/** Close the domain socket (going home / leaving a visit). */
export function detachDomain(ownerId?: number) {
  if (!session) return;
  if (ownerId != null && session.ownerId !== ownerId) return;
  session.net.close();
  session = null;
}
