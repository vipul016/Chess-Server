"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupGameRoom = setupGameRoom;
exports.handleFindMatch = handleFindMatch;
exports.handleCreatePrivateRoom = handleCreatePrivateRoom;
exports.handleJoinPrivateRoom = handleJoinPrivateRoom;
exports.handlePlayBot = handlePlayBot;
// src/ws/handlers/matchmaking.ts
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const chess_js_1 = require("chess.js");
const state_1 = require("../state");
const stockfish_service_1 = require("../../services/stockfish.service");
const prisma = new client_1.PrismaClient();
// Helper to handle the actual room creation and DB setup to avoid repeating code
async function setupGameRoom(player1, player2) {
    const roomId = crypto_1.default.randomUUID();
    state_1.rooms.set(roomId, {
        players: [player1, player2],
        game: new chess_js_1.Chess(),
        clock: { w: 600000, b: 600000 },
        lastMoveTime: Date.now()
    });
    const room = state_1.rooms.get(roomId);
    player1.roomId = roomId;
    player1.color = 'w';
    player1.sessionId = crypto_1.default.randomUUID();
    player1.lastOpponent = player2;
    player2.roomId = roomId;
    player2.color = 'b';
    player2.sessionId = crypto_1.default.randomUUID();
    player2.lastOpponent = player1;
    const dbGame = await prisma.game.create({
        data: {
            status: 'active',
            whitePlayerId: player1.userId,
            blackPlayerId: player2.userId
        }
    });
    room.dbGameId = dbGame.id;
    const playersInfo = {
        white: { username: player1.username, rating: player1.rating },
        black: { username: player2.username, rating: player2.rating }
    };
    (0, state_1.sendToClient)(player1, { type: 'match_found', roomId, color: 'white', sessionId: player1.sessionId, players: playersInfo });
    (0, state_1.sendToClient)(player2, { type: 'match_found', roomId, color: 'black', sessionId: player2.sessionId, players: playersInfo });
    const startingState = {
        type: 'state',
        fen: room.game.fen(),
        turn: room.game.turn(),
        clock: room.clock
    };
    (0, state_1.sendToClient)(player1, startingState);
    (0, state_1.sendToClient)(player2, startingState);
    console.log(`Match created: Room ${roomId}`);
}
async function handleFindMatch(ws) {
    // 1. Clean up any dead connections in the queue
    for (let i = state_1.matchQueue.length - 1; i >= 0; i--) {
        if (state_1.matchQueue[i].readyState !== ws.OPEN) {
            state_1.matchQueue.splice(i, 1);
        }
    }
    // Prevent double-queueing
    if (state_1.matchQueue.includes(ws))
        return;
    // 2. Look for an opponent within a widening Elo range
    const timeWaiting = Date.now() - (ws.queuedAt || Date.now());
    const ELO_THRESHOLD = 200 + Math.floor(timeWaiting / 5000) * 50; // Widen 50 points every 5 seconds
    let matchIndex = -1;
    for (let i = 0; i < state_1.matchQueue.length; i++) {
        const potentialOpponent = state_1.matchQueue[i];
        if (Math.abs(potentialOpponent.rating - ws.rating) <= ELO_THRESHOLD) {
            matchIndex = i;
            break;
        }
    }
    // 3. If match found, remove from queue and start game
    if (matchIndex !== -1) {
        const opponent = state_1.matchQueue.splice(matchIndex, 1)[0];
        await setupGameRoom(opponent, ws);
    }
    else {
        // 4. If no match, add to queue
        ws.queuedAt = ws.queuedAt || Date.now();
        state_1.matchQueue.push(ws);
        console.log(`Player ${ws.username} (Elo: ${ws.rating}) joined matchmaking queue...`);
    }
}
function handleCreatePrivateRoom(ws) {
    // Generate a simple 6-character alphanumeric code
    const roomCode = crypto_1.default.randomBytes(3).toString('hex').toUpperCase();
    state_1.pendingPrivateRooms.set(roomCode, ws);
    (0, state_1.sendToClient)(ws, { type: 'room_created', roomCode });
    console.log(`Player ${ws.username} created private room: ${roomCode}`);
}
async function handleJoinPrivateRoom(ws, roomCode) {
    const host = state_1.pendingPrivateRooms.get(roomCode);
    if (!host) {
        (0, state_1.sendToClient)(ws, { type: 'error', message: 'Invalid or expired room code.' });
        return;
    }
    if (host.readyState !== ws.OPEN) {
        state_1.pendingPrivateRooms.delete(roomCode);
        (0, state_1.sendToClient)(ws, { type: 'error', message: 'The host has disconnected.' });
        return;
    }
    if (host === ws) {
        (0, state_1.sendToClient)(ws, { type: 'error', message: 'You cannot join your own room.' });
        return;
    }
    // Remove from pending map and start the game!
    state_1.pendingPrivateRooms.delete(roomCode);
    await setupGameRoom(host, ws);
}
async function handlePlayBot(ws, level) {
    const roomId = crypto_1.default.randomUUID();
    state_1.rooms.set(roomId, {
        players: [ws], // Bot is not a websocket
        game: new chess_js_1.Chess(),
        clock: { w: 600000, b: 600000 },
        lastMoveTime: Date.now(),
        dbGameId: '',
        isBotGame: true,
        botLevel: level,
        botColor: 'b' // Human plays White
    });
    const room = state_1.rooms.get(roomId);
    // Initialize Stockfish for this room
    room.botEngine = new stockfish_service_1.StockfishService();
    room.botEngine.setSkillLevel(level);
    ws.roomId = roomId;
    ws.color = 'w';
    ws.sessionId = crypto_1.default.randomUUID();
    const dbGame = await prisma.game.create({
        data: {
            status: 'active',
            whitePlayerId: ws.userId
            // blackPlayerId remains null for bot
        }
    });
    room.dbGameId = dbGame.id;
    const playersInfo = {
        white: { username: ws.username, rating: ws.rating },
        black: { username: `Stockfish Lvl ${level}`, rating: level * 100 }
    };
    (0, state_1.sendToClient)(ws, { type: 'match_found', roomId, color: 'white', sessionId: ws.sessionId, players: playersInfo });
    const startingState = {
        type: 'state',
        fen: room.game.fen(),
        turn: room.game.turn(),
        clock: { w: 600000, b: 600000 } // Clock can just be static for bot games for now, or we can use the same clock logic
    };
    (0, state_1.sendToClient)(ws, startingState);
    console.log(`Bot Match created: Room ${roomId} for player ${ws.username}`);
}
