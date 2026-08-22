// ══════════ 리프트바운드 시뮬레이터 — 방 코드 시그널링 (Cloudflare Worker) ══════════
// 하는 일: 방 코드로 만들어진 "방"에 들어온 두 사람 사이에서 offer/answer를 한 번 전달한다.
// 하지 않는 일: 게임 데이터 중계·저장·계정. 연결이 맺어지면 클라이언트가 즉시 끊는다.
//
// 오가는 내용은 클라이언트가 방 코드로 유도한 키로 이미 암호화되어 있어, 서버는 내용을 모른다.
// 배포 방법은 같은 폴더의 README.md 참고.

const MAX_DATA = 8192;      // 압축된 SDP는 200자 안팎 — 넉넉한 상한
const MAX_PEERS = 8;        // 한 방에 붙을 수 있는 소켓 수 (사고 방지용)

export class Room {
  constructor(state) {
    this.state = state;
    this.peers = new Set();
    this.last = {};           // slot -> data (늦게 들어온 쪽에게 재생해 준다)
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    if (this.peers.size >= MAX_PEERS) {
      return new Response('room full', { status: 429 });
    }

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    this.peers.add(server);

    // 방장이 먼저 와서 offer를 올려 뒀다면, 지금 들어온 사람에게 바로 전달
    for (const slot of Object.keys(this.last)) {
      try { server.send(JSON.stringify({ slot, data: this.last[slot] })); } catch (e) {}
    }

    server.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m.slot !== 'string' || typeof m.data !== 'string') return;
      if (m.slot.length > 8 || m.data.length > MAX_DATA) return;
      this.last[m.slot] = m.data;
      const out = JSON.stringify({ slot: m.slot, data: m.data });
      for (const p of this.peers) {
        if (p === server) continue;             // 자기 메시지는 되돌려주지 않는다
        try { p.send(out); } catch (e) {}
      }
    });

    const drop = () => this.peers.delete(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 방 이름은 클라이언트가 방 코드를 해시해 만든 것이라 서버는 코드를 모른다
    const m = url.pathname.match(/^\/r\/([a-f0-9]{8,64})$/);
    if (!m) return new Response('riftbound signal: ok', { status: 200 });
    const id = env.ROOM.idFromName(m[1]);
    return env.ROOM.get(id).fetch(request);
  },
};
