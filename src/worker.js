/**
 * Commando Lizard — Mafia room Worker (per-device role reveal, no email)
 *
 * Routes (all under mafia.commando-lizard.xyz):
 *   POST /api/rooms                        -> host creates a room -> {roomId, code}
 *   GET  /r/:roomId                        -> player join + lobby + reveal page (QR target)
 *   POST /api/rooms/:roomId/join           -> player submits {name} -> {playerId}
 *   GET  /api/rooms/:roomId/players        -> host polls roster (names only)
 *   POST /api/rooms/:roomId/start          -> host assigns roles (no email)
 *   GET  /api/rooms/:roomId/me/:playerId   -> player polls for their own role
 *
 * Bindings (wrangler.toml):
 *   [[durable_objects.bindings]]
 *   name = "ROOMS"; class_name = "MafiaRoom"
 *
 * No email/Mailgun config needed — roles are shown on each player's device.
 */

// Per-role descriptions shown with the reveal.
/**
 * Role catalog — single source of truth.
 * key: machine name        team: "town" | "mafia" | "neutral"
 * minPlayers: role becomes available to add once the room reaches this size.
 * The base four are always available (minPlayers: 0).
 */
const ROLES = {
  Mafioso:   { team: "mafia",   minPlayers: 0, info: "You wake at night with the other mafiosi and choose one player to eliminate. Stay hidden by day." },
  Citizen:   { team: "town",    minPlayers: 0, info: "You have no special power. Use discussion and your vote to find the mafia." },
  Doctor:    { team: "town",    minPlayers: 0, info: "Each night you protect one player from being eliminated. You may save yourself." },
  Detective: { team: "town",    minPlayers: 0, info: "Each night you investigate one player and learn whether they are mafia." },
  Godfather: { team: "mafia",   minPlayers: 6, info: "You lead the mafia. When the Detective investigates you, you appear innocent. If the mafiosi fall, you carry on alone." },
  Jester:    { team: "neutral", minPlayers: 7, info: "You win if the town votes YOU out. Act suspicious enough to get lynched — but not so obvious they spare you." },
  Vigilante: { team: "town",    minPlayers: 8, info: "Once per night you may kill one player. Choose carefully — kill a townsperson and you have helped the mafia." },
  Bodyguard: { team: "town",    minPlayers: 9, info: "Each night you guard one player. If the mafia attack them, you die in their place and they survive." },
  Mayor:     { team: "town",    minPlayers: 10, info: "Once you reveal yourself, your vote counts double for the rest of the game." },
};

// Back-compat alias used by the reveal endpoint.
const ROLE_INFO = Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.info]));

const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const PRESENCE_MS = 10000; // a player counts as "away" after 10s with no heartbeat
const MIN_PLAYERS = 4;     // fewest players needed to start a game

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (request.method === "POST" && pathname === "/api/rooms") {
        const roomId = crypto.randomUUID();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
        return stub.fetch("https://do/init", {
          method: "POST",
          body: JSON.stringify({ roomId }),
        });
      }

      const joinMatch = pathname.match(/^\/r\/([0-9a-f-]+)$/);
      if (request.method === "GET" && joinMatch) {
        return html(playerPage());
      }

      const roomMatch = pathname.match(
        /^\/api\/rooms\/([0-9a-f-]+)\/(join|players|start|roles|table|toggle|me|remove)(?:\/([0-9a-f-]+))?$/
      );
      if (roomMatch) {
        const [, roomId, action, playerId] = roomMatch;
        const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
        const doUrl = playerId ? `https://do/${action}/${playerId}` : `https://do/${action}`;
        return stub.fetch(doUrl, request);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};

export class MafiaRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Room state is kept hot in memory and loaded from storage only once (on the
    // first request after a cold start). Polling and heartbeats read from memory;
    // storage is written ONLY when something actually changes (join/start/toggle/remove).
    this.loaded = false;
    this.meta = null;
    this.players = [];
    // playerId -> last-heartbeat ms. Deliberately in-memory only: presence is
    // ephemeral, so persisting it on every 2s poll would just burn storage ops.
    // If the DO is ever evicted, players simply re-appear on their next heartbeat.
    this.lastSeen = new Map();
  }

  async load() {
    if (this.loaded) return;
    await this.state.blockConcurrencyWhile(async () => {
      if (this.loaded) return;
      this.meta = (await this.state.storage.get("meta")) || null;
      this.players = (await this.state.storage.get("players")) || [];
      this.loaded = true;
    });
  }

  online(playerId) {
    return Date.now() - (this.lastSeen.get(playerId) || 0) < PRESENCE_MS;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.slice(1).split("/");
    const action = parts[0];
    await this.load();

    if (action === "init") {
      const { roomId } = await request.json();
      // The host is always the omniscient referee — they run the night with full
      // knowledge of every role, so roles are never masked from the host.
      this.meta = { roomId, started: false };
      this.players = [];
      this.lastSeen.clear();
      await this.state.storage.put("meta", this.meta);
      await this.state.storage.put("players", this.players);
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return Response.json({ roomId });
    }

    if (action === "join") {
      if (this.meta?.started) return Response.json({ error: "already_started" }, { status: 409 });
      const { name } = await request.json();
      const trimmed = (name || "").trim();
      if (!trimmed) return Response.json({ error: "invalid" }, { status: 400 });
      // Reject a name that's already in the room (case-insensitive) so one person
      // can't appear twice. Combined with client-side session resume, this keeps
      // the roster accurate.
      if (this.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
        return Response.json({ error: "name_taken" }, { status: 409 });
      }
      const playerId = crypto.randomUUID();
      this.players.push({ playerId, name: trimmed, role: null, alive: true });
      this.lastSeen.set(playerId, Date.now());
      await this.state.storage.put("players", this.players);
      return Response.json({ ok: true, playerId, count: this.players.length });
    }

    if (action === "players") {
      const roster = this.players.map((p) => ({
        playerId: p.playerId,
        name: p.name,
        online: this.online(p.playerId),
      }));
      return Response.json({
        code: this.meta?.code,
        started: this.meta?.started || false,
        players: roster,
        count: roster.filter((p) => p.online).length, // only present players count
      });
    }

    if (action === "start") {
      if (this.meta?.started) return Response.json({ error: "already_started" }, { status: 409 });

      // Drop anyone who has left (no recent heartbeat) so they aren't dealt a role.
      const present = this.players.filter((p) => this.online(p.playerId));
      if (present.length < MIN_PLAYERS) {
        return Response.json(
          { error: "min_players", min: MIN_PLAYERS, have: present.length },
          { status: 400 }
        );
      }

      const body = await request.json(); // { counts: { Mafioso: 2, Citizen: 3, ... } }
      const roles = buildRoleList(body.counts || {}, present.length);
      if (!roles) {
        return Response.json(
          { error: "role_count_mismatch", needed: present.length },
          { status: 400 }
        );
      }

      // A playable game needs at least one Mafia and at least one Town role.
      const teams = roles.map((r) => ROLES[r]?.team);
      if (!teams.includes("mafia")) return Response.json({ error: "need_mafia" }, { status: 400 });
      if (!teams.includes("town")) return Response.json({ error: "need_town" }, { status: 400 });

      shuffle(roles);
      present.forEach((p, i) => (p.role = roles[i]));
      this.players = present; // the pruned roster becomes the game roster
      this.meta = { ...this.meta, started: true };
      await this.state.storage.put("players", this.players);
      await this.state.storage.put("meta", this.meta);
      return Response.json({ ok: true, assigned: this.players.length });
    }

    if (action === "roles") {
      const n = this.players.length;
      const available = Object.entries(ROLES)
        .filter(([, r]) => n >= r.minPlayers)
        .map(([name, r]) => ({ name, team: r.team, info: r.info }));
      const locked = Object.entries(ROLES)
        .filter(([, r]) => n < r.minPlayers)
        .map(([name, r]) => ({ name, unlocksAt: r.minPlayers }));
      return Response.json({ playerCount: n, available, locked });
    }

    if (action === "table") {
      return Response.json({
        started: this.meta?.started || false,
        players: this.players.map((p) => ({
          playerId: p.playerId,
          name: p.name,
          role: p.role,
          alive: p.alive !== false,
        })),
      });
    }

    if (action === "toggle") {
      const playerId = parts[1];
      const me = this.players.find((p) => p.playerId === playerId);
      if (!me) return Response.json({ error: "not_found" }, { status: 404 });
      me.alive = me.alive === false; // flip
      await this.state.storage.put("players", this.players);
      return Response.json({ ok: true, playerId, alive: me.alive });
    }

    if (action === "remove") {
      // Host manually removes a player from the lobby (e.g. a ghost or a mistake).
      if (this.meta?.started) return Response.json({ error: "already_started" }, { status: 409 });
      const playerId = parts[1];
      this.players = this.players.filter((p) => p.playerId !== playerId);
      this.lastSeen.delete(playerId);
      await this.state.storage.put("players", this.players);
      return Response.json({ ok: true, count: this.players.length });
    }

    if (action === "me") {
      const playerId = parts[1];
      const me = this.players.find((p) => p.playerId === playerId);
      if (!me) return Response.json({ error: "not_found" }, { status: 404 });
      this.lastSeen.set(playerId, Date.now()); // heartbeat — in-memory only, no storage write
      if (!this.meta?.started) return Response.json({ started: false });
      return Response.json({
        started: true,
        name: me.name,
        role: me.role,
        roleInfo: ROLE_INFO[me.role] || "",
        team: ROLES[me.role]?.team || "town",
      });
    }

    return new Response("DO: not found", { status: 404 });
  }

  // TTL cleanup: wipe everything once the room expires.
  async alarm() {
    await this.state.storage.deleteAll();
    this.meta = null;
    this.players = [];
    this.lastSeen.clear();
    this.loaded = true; // state is now known-empty; no need to re-read storage
  }
}

// ---------- helpers ----------

function buildRoleList(counts, playerCount) {
  const list = [];
  for (const [roleName, count] of Object.entries(counts)) {
    if (!ROLES[roleName]) continue; // ignore unknown roles
    const n = Math.max(0, parseInt(count, 10) || 0);
    if (n > 0 && playerCount < ROLES[roleName].minPlayers) return null; // role not unlocked yet
    for (let i = 0; i < n; i++) list.push(roleName);
  }
  if (list.length !== playerCount) return null;
  return list;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Slim shell for the player page. Styles/logic live in the static /player.css and
// /player.js assets; the client derives the room id from the URL (/r/:roomId).
function playerPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mafia</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/player.css">
</head>
<body>
<div class="wrap">
  <h1 class="title">MA<span class="accent">F</span>IA</h1>
  <div class="tagline">trust no one</div>

  <div id="joinView">
    <input id="name" placeholder="Your name" autocomplete="name">
    <button id="go">Join</button>
    <div class="msg" id="joinMsg"></div>
  </div>

  <div id="lobbyView" class="hidden">
    <div class="msg" id="lobbyMsg">You're in. Waiting for the host to start…</div>
    <details class="howto" open>
      <summary>New to Mafia? How to play</summary>
      <div class="rules"></div>
    </details>
  </div>

  <div id="roleView" class="hidden">
    <div class="reveal-label">Your secret role</div>
    <div class="role" id="roleName"></div>
    <div class="roleinfo" id="roleInfo"></div>
    <details class="howto">
      <summary>New to Mafia? How to play</summary>
      <div class="rules"></div>
    </details>
  </div>
</div>

<script src="/player.js"></script>
</body>
</html>`;
}
