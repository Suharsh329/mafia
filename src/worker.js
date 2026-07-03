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

// Trimmed for the phone: the night/day loop + win conditions.
// Each player already sees their own role and its description above this.
const RULES = `Mafia is a game of hidden identities. A few players are secretly Mafia; everyone else is Town (Citizens, plus special roles like the Doctor and Detective).

The game alternates between two phases:

NIGHT — everyone "sleeps". The Mafia secretly choose one player to eliminate. Special roles act too: the Doctor protects someone, the Detective investigates someone.

DAY — the host announces who was eliminated overnight. The living players discuss, accuse, and vote. Whoever gets a majority is eliminated.

These phases repeat until one side wins:
- Town wins when every Mafioso is eliminated.
- Mafia win when they equal or outnumber the Town.

Keep your role secret, trust no one, and — most importantly — have fun!`;

const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const PRESENCE_MS = 10000; // a player counts as "away" after 10s with no heartbeat
const MIN_PLAYERS = 4;     // fewest players needed to start a game

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (request.method === "POST" && pathname === "/api/rooms") {
        const { hostMode } = await request.json().catch(() => ({}));
        const roomId = crypto.randomUUID();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
        const res = await stub.fetch("https://do/init", {
          method: "POST",
          body: JSON.stringify({ roomId, hostMode }),
        });
        return res; // {roomId, code, hostMode}
      }

      const joinMatch = pathname.match(/^\/r\/([0-9a-f-]+)$/);
      if (request.method === "GET" && joinMatch) {
        return html(playerPage(joinMatch[1]));
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
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.slice(1).split("/");
    const action = parts[0];

    if (action === "init") {
      const { roomId, hostMode } = await request.json();
      const code = shortCode(roomId);
      // hostMode: "omniscient" (host sees roles) | "blind" (roles masked from host)
      const mode = hostMode === "blind" ? "blind" : "omniscient";
      await this.state.storage.put("meta", { roomId, code, started: false, hostMode: mode });
      await this.state.storage.put("players", []);
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return Response.json({ roomId, code, hostMode: mode });
    }

    if (action === "join") {
      const meta = await this.state.storage.get("meta");
      if (meta?.started) return Response.json({ error: "already_started" }, { status: 409 });
      const { name } = await request.json();
      const trimmed = (name || "").trim();
      if (!trimmed) return Response.json({ error: "invalid" }, { status: 400 });
      const players = (await this.state.storage.get("players")) || [];
      // Reject a name that's already in the room (case-insensitive) so one person
      // can't appear twice. Combined with client-side session resume, this keeps
      // the roster accurate.
      if (players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
        return Response.json({ error: "name_taken" }, { status: 409 });
      }
      const playerId = crypto.randomUUID();
      players.push({ playerId, name: trimmed, role: null, alive: true, lastSeen: Date.now() });
      await this.state.storage.put("players", players);
      return Response.json({ ok: true, playerId, count: players.length });
    }

    if (action === "players") {
      const players = (await this.state.storage.get("players")) || [];
      const meta = await this.state.storage.get("meta");
      const now = Date.now();
      const roster = players.map((p) => ({
        playerId: p.playerId,
        name: p.name,
        online: now - (p.lastSeen || 0) < PRESENCE_MS,
      }));
      return Response.json({
        code: meta?.code,
        started: meta?.started || false,
        players: roster,
        count: roster.filter((p) => p.online).length, // only present players count
      });
    }

    if (action === "start") {
      const meta = await this.state.storage.get("meta");
      if (meta?.started) return Response.json({ error: "already_started" }, { status: 409 });

      // Drop anyone who has left (no recent heartbeat) so they aren't dealt a role.
      const now = Date.now();
      const all = (await this.state.storage.get("players")) || [];
      const players = all.filter((p) => now - (p.lastSeen || 0) < PRESENCE_MS);

      if (players.length < MIN_PLAYERS) {
        return Response.json(
          { error: "min_players", min: MIN_PLAYERS, have: players.length },
          { status: 400 }
        );
      }

      const body = await request.json(); // { counts: { Mafioso: 2, Citizen: 3, ... } }
      const roles = buildRoleList(body.counts || {}, players.length);
      if (!roles) {
        return Response.json(
          { error: "role_count_mismatch", needed: players.length },
          { status: 400 }
        );
      }

      // A playable game needs at least one Mafia and at least one Town role.
      const teams = roles.map((r) => ROLES[r]?.team);
      if (!teams.includes("mafia")) return Response.json({ error: "need_mafia" }, { status: 400 });
      if (!teams.includes("town")) return Response.json({ error: "need_town" }, { status: 400 });

      shuffle(roles);
      players.forEach((p, i) => (p.role = roles[i]));
      await this.state.storage.put("players", players); // persists the pruned roster
      await this.state.storage.put("meta", { ...meta, started: true });
      return Response.json({ ok: true, assigned: players.length });
    }

    if (action === "roles") {
      const players = (await this.state.storage.get("players")) || [];
      const n = players.length;
      const available = Object.entries(ROLES)
        .filter(([, r]) => n >= r.minPlayers)
        .map(([name, r]) => ({ name, team: r.team, info: r.info }));
      const locked = Object.entries(ROLES)
        .filter(([, r]) => n < r.minPlayers)
        .map(([name, r]) => ({ name, unlocksAt: r.minPlayers }));
      return Response.json({ playerCount: n, available, locked });
    }

    if (action === "table") {
      const meta = await this.state.storage.get("meta");
      const players = (await this.state.storage.get("players")) || [];
      const blind = meta?.hostMode === "blind";
      return Response.json({
        started: meta?.started || false,
        hostMode: meta?.hostMode || "omniscient",
        players: players.map((p) => ({
          playerId: p.playerId,
          name: p.name,
          role: blind ? null : p.role, // masked from host in blind mode
          alive: p.alive !== false,
        })),
      });
    }

    if (action === "toggle") {
      const playerId = parts[1];
      const players = (await this.state.storage.get("players")) || [];
      const me = players.find((p) => p.playerId === playerId);
      if (!me) return Response.json({ error: "not_found" }, { status: 404 });
      me.alive = me.alive === false; // flip
      await this.state.storage.put("players", players);
      return Response.json({ ok: true, playerId, alive: me.alive });
    }

    if (action === "remove") {
      // Host manually removes a player from the lobby (e.g. a ghost or a mistake).
      const meta = await this.state.storage.get("meta");
      if (meta?.started) return Response.json({ error: "already_started" }, { status: 409 });
      const playerId = parts[1];
      const players = (await this.state.storage.get("players")) || [];
      const next = players.filter((p) => p.playerId !== playerId);
      await this.state.storage.put("players", next);
      return Response.json({ ok: true, count: next.length });
    }

    if (action === "me") {
      const playerId = parts[1];
      const meta = await this.state.storage.get("meta");
      const players = (await this.state.storage.get("players")) || [];
      const me = players.find((p) => p.playerId === playerId);
      if (!me) return Response.json({ error: "not_found" }, { status: 404 });
      me.lastSeen = Date.now(); // this poll is the player's heartbeat
      await this.state.storage.put("players", players);
      if (!meta?.started) return Response.json({ started: false });
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

function shortCode(roomId) {
  const hex = roomId.replace(/-/g, "").slice(0, 8);
  let x = parseInt(hex, 16);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += alphabet[x % alphabet.length];
    x = Math.floor(x / alphabet.length);
  }
  return code;
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

function playerPage(roomId) {
  const rulesHtml = RULES.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mafia</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#0a0a0c; --panel:#141417; --blood:#b3122a; --blood-bright:#e01838;
    --bone:#e8e4dc; --muted:#7a7782; --line:#2a2a30;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{ font-family:"Inter",system-ui,sans-serif; background:var(--ink); color:var(--bone);
    padding:28px 20px 48px; min-height:100vh;
    background-image:radial-gradient(circle at 50% -10%, rgba(179,18,42,.18), transparent 55%); }
  .wrap{max-width:400px;margin:0 auto}

  .title{ font-family:"Oswald",sans-serif; font-weight:700; letter-spacing:.18em;
    font-size:2.8rem; text-align:center; margin:0; text-transform:uppercase;
    color:var(--bone); line-height:1; }
  .title .accent{color:var(--blood-bright)}
  .tagline{ text-align:center; color:var(--muted); letter-spacing:.35em;
    text-transform:uppercase; font-size:.65rem; margin:8px 0 30px; }

  input{ width:100%; padding:14px; margin:8px 0; border:1px solid var(--line);
    background:var(--panel); color:var(--bone); border-radius:2px; font-size:16px;
    font-family:"Inter",sans-serif; }
  input:focus{outline:none;border-color:var(--blood)}
  input::placeholder{color:var(--muted)}

  button{ width:100%; padding:15px; margin-top:14px; border:1px solid var(--blood);
    background:var(--blood); color:#fff; font-size:1rem; cursor:pointer; border-radius:2px;
    font-family:"Oswald",sans-serif; letter-spacing:.12em; text-transform:uppercase; font-weight:600;
    transition:background .15s,border-color .15s; }
  button:hover{background:var(--blood-bright);border-color:var(--blood-bright)}
  button:disabled{opacity:.4;cursor:default;background:#3a1118;border-color:#3a1118}

  .msg{text-align:center;margin:14px 0;min-height:1.2em;font-size:.92rem;color:var(--muted)}

  details.howto{margin-top:18px;background:var(--panel);border:1px solid var(--line);border-radius:3px}
  details.howto>summary{cursor:pointer;padding:14px 16px;list-style:none;user-select:none;
    font-family:"Oswald",sans-serif;letter-spacing:.1em;text-transform:uppercase;font-size:.9rem;color:var(--bone)}
  details.howto>summary::-webkit-details-marker{display:none}
  details.howto>summary::before{content:"▸";color:var(--blood-bright);margin-right:10px}
  details.howto[open]>summary::before{content:"▾"}
  .rules{white-space:pre-wrap;padding:2px 16px 16px;font-size:14px;line-height:1.6;
    border-top:1px solid var(--line);color:var(--bone)}

  .reveal-label{text-align:center;color:var(--muted);letter-spacing:.25em;
    text-transform:uppercase;font-size:.7rem;margin-top:8px}
  .role{ text-align:center; font-family:"Oswald",sans-serif; font-size:2.6rem; font-weight:700;
    letter-spacing:.06em; text-transform:uppercase; color:var(--bone); margin:10px 0 6px; }
  .role.mafia{color:var(--blood-bright)}
  .role.neutral{color:#d9a441}
  .roleinfo{text-align:center;font-size:15px;line-height:1.55;color:var(--bone);max-width:340px;margin:0 auto}
  .hidden{display:none}
</style>
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
      <div class="rules">${rulesHtml}</div>
    </details>
  </div>

  <div id="roleView" class="hidden">
    <div class="reveal-label">Your secret role</div>
    <div class="role" id="roleName"></div>
    <div class="roleinfo" id="roleInfo"></div>
    <details class="howto">
      <summary>New to Mafia? How to play</summary>
      <div class="rules">${rulesHtml}</div>
    </details>
  </div>
</div>

<script>
  const roomId = ${JSON.stringify(roomId)};
  const KEY = 'mafia:room:' + roomId;
  let playerId = null;
  const $ = (id) => document.getElementById(id);

  function show(view) {
    ['joinView', 'lobbyView', 'roleView'].forEach(v =>
      $(v).classList.toggle('hidden', v !== view));
  }
  function showRole(data) {
    const el = $('roleName');
    el.textContent = data.role;
    el.className = 'role ' + (data.team || '');
    $('roleInfo').textContent = data.roleInfo;
    show('roleView');
  }

  $('go').onclick = async () => {
    const name = $('name').value.trim();
    if (!name) { $('joinMsg').textContent = 'Enter your name.'; return; }
    $('go').disabled = true; $('joinMsg').textContent = 'Joining…';
    try {
      const r = await fetch('/api/rooms/' + roomId + '/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await r.json();
      if (r.ok) {
        playerId = data.playerId;
        localStorage.setItem(KEY, playerId); // so a refresh resumes instead of re-joining
        show('lobbyView');
        pollForRole();
      } else if (data.error === 'name_taken') {
        $('joinMsg').textContent = 'That name is already taken — try another.';
        $('go').disabled = false;
      } else if (data.error === 'already_started') {
        $('joinMsg').textContent = 'Game already started.';
      } else {
        $('joinMsg').textContent = 'Could not join. Try again.';
        $('go').disabled = false;
      }
    } catch (e) {
      $('joinMsg').textContent = 'Network error. Try again.';
      $('go').disabled = false;
    }
  };

  // Polling /me doubles as this player's heartbeat, so the host sees them as present.
  async function pollForRole() {
    try {
      const r = await fetch('/api/rooms/' + roomId + '/me/' + playerId);
      if (r.status === 404) { // host removed us, or the room was reset
        localStorage.removeItem(KEY); playerId = null;
        show('joinView'); $('go').disabled = false;
        $('joinMsg').textContent = 'You were removed from the room.';
        return;
      }
      const data = await r.json();
      if (data.started && data.role) { showRole(data); return; } // game running: stop polling
    } catch (e) { /* ignore, retry */ }
    setTimeout(pollForRole, 2000);
  }

  // On load, resume an existing session (refresh / reopened link) rather than joining twice.
  (async () => {
    const saved = localStorage.getItem(KEY);
    if (!saved) return;
    playerId = saved;
    try {
      const r = await fetch('/api/rooms/' + roomId + '/me/' + playerId);
      if (r.status === 404) { localStorage.removeItem(KEY); playerId = null; return; }
      const data = await r.json();
      if (data.started && data.role) { showRole(data); return; }
      show('lobbyView');
      pollForRole();
    } catch (e) { /* fall back to the join form */ }
  })();
</script>
</body>
</html>`;
}
