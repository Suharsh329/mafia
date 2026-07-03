# Mafia

A party-game host for [Mafia](https://en.wikipedia.org/wiki/Mafia_(party_game)), running entirely on **Cloudflare Workers + Durable Objects**.

The host opens the app and creates a room. Players scan a QR code (or enter a 4-letter code) to join from their own phones. When the host starts the game, roles are dealt server-side and **revealed privately on each player's device** — no email, no shared screen, no way to peek at someone else's card.

## How it works

- **`src/worker.js`** — the Worker. Routes API calls, serves the player join/reveal page (`/r/:roomId`), and defines the `MafiaRoom` Durable Object that holds each room's state (players, roles, alive/dead status). Rooms auto-delete 3 hours after creation via a Durable Object alarm.
- **`public/index.html`** — the host UI, served as a static asset at `/`. Create a room, watch the roster fill in, configure role counts, start the game, and run the live table.
- **`wrangler.toml`** — binds the `ROOMS` Durable Object (SQLite-backed) and points static assets at `public/`.

Extra roles (Godfather, Jester, Vigilante, Bodyguard, Mayor) unlock automatically as the player count grows. Two host modes: **omniscient** (host sees every role) or **blind narrator** (roles hidden from the host too).

## Develop

```sh
npm install
npm run dev        # wrangler dev — local server at http://localhost:8787
```

Open the host page at `http://localhost:8787/`. To simulate players, open `http://localhost:8787/r/<roomId>` in other tabs (the roomId is shown in the join URL under the QR code).

## Deploy

```sh
npm run deploy     # wrangler deploy
```

You'll need a Cloudflare account (`npx wrangler login` first). The SQLite-backed Durable Object works on the free plan.

## Legacy

The original email-based version (host enters everyone's name + email, roles sent via an external mailer) is preserved in [`legacy/`](legacy/).
