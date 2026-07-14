# Chess-Server

Real-time multiplayer chess backend built with Node.js, TypeScript, WebSockets, and PostgreSQL. The server is fully authoritative — clients never dictate game state, only send move intents — with JWT authentication, Elo-based rating and matchmaking, session-verified reconnection, bot opponents powered by Stockfish, and asynchronous post-game analysis.

## Features

**Real-time gameplay**
- Authoritative move validation over WebSockets using `chess.js` — all game rules (legality, turns, checkmate/stalemate/draw detection) enforced server-side
- Server-owned chess clocks with automatic timeout (flag-fall) detection via a background sweeper
- Resignation and draw offer/response flow
- Heartbeat-based liveness detection (ping/pong) to distinguish a dead connection from a slow one

**Reconnection**
- Session-based reconnection with **identity verification** — a reconnect request is only honored if the requesting user's JWT identity matches the original player, preventing session hijacking
- On reconnect, the client receives full current state (board, turn, clock) rather than a replay of the entire move history

**Matchmaking & rooms**
- Rating-based matchmaking queue with a widening Elo threshold the longer a player waits
- Private rooms via shareable room codes
- Spectator support for live games
- Rematch flow between the same two players

**Accounts, ratings & persistence**
- JWT authentication (signup/login), passwords hashed with bcrypt
- Standard Elo rating system, updated atomically (via a DB transaction) alongside win/loss/draw counts on every game completion
- Every move persisted to PostgreSQL (via Prisma) for full game history and replay, independent of in-memory server state

**Bots & analysis**
- Play against Stockfish at configurable difficulty levels
- Post-game analysis (per-move evaluation and move-quality classification) computed via the real Stockfish UCI protocol
- Analysis runs as an **asynchronous background job**, not blocking the request — clients poll for completion, so heavy engine analysis never affects live gameplay

**Security & reliability**
- Zod-based request validation on all inputs
- Rate limiting on both HTTP and WebSocket messages
- CORS restricted appropriately, route-level access control (e.g., only game participants can view that game's analysis/history)
- Graceful shutdown on SIGINT/SIGTERM — active games are cleanly aborted and their status persisted, engine subprocesses are killed
- Automated test suite covering auth flows, Elo math, and full WebSocket game lifecycles (matchmaking, moves, resign, chat, private rooms)

## Tech Stack
Node.js, TypeScript, `ws`, `chess.js`, PostgreSQL, Prisma, JWT, bcrypt, Zod, Jest/Supertest, Stockfish (UCI)

## Architecture

```
Client (WebSocket + REST)
        │
┌───────▼────────┐
│  Express + WS    │  JWT auth on both HTTP routes and WS upgrade
└───────┬────────┘
        │
┌───────▼────────┐
│  Game Handlers    │  matchmaking, gameplay, connection/reconnection
└───────┬────────┘
        │
┌───────▼────────┐        ┌─────────────────┐
│  In-memory Rooms  │       │ Analysis Queue     │  async Stockfish jobs
│  (live game state) │       │ (background worker) │
└───────┬────────┘        └─────────┬───────┘
        │                            │
┌───────▼────────────────────────────▼───────┐
│              PostgreSQL (Prisma)              │  users, games, moves
└──────────────────────────────────────────────┘
```

## Getting Started

```bash
git clone https://github.com/vipul016/Chess-Server.git
cd Chess-Server
npm install

# Configure environment
cp .env.example .env
# Set DATABASE_URL and JWT_SECRET in .env

npx prisma migrate deploy
npm run dev
```

## Testing

```bash
npm test
```

Covers authentication flows, Elo calculation, and full WebSocket game lifecycles (matchmaking, moves, resignation, chat, private rooms).

## Known Limitations
- Single-instance only — no Redis/horizontal scaling yet (in-memory room state is per-process)
- The analysis queue is in-memory; a server restart mid-analysis does not currently auto-resume pending jobs

## Related
Pairs with [Chess-Client](https://github.com/vipul016/Chess-Client) — the React frontend for this backend.