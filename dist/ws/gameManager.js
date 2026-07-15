"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWebSockets = setupWebSockets;
exports.shutdownActiveGames = shutdownActiveGames;
const client_1 = require("@prisma/client");
const state_1 = require("./state");
const gameplay_1 = require("./handlers/gameplay");
const connection_1 = require("./handlers/connection");
const gameplay_2 = require("./handlers/gameplay");
const matchmaking_1 = require("./handlers/matchmaking");
const prisma = new client_1.PrismaClient();
let heartBeatInterval;
let sweeperInterval;
function setupWebSockets(wss) {
    wss.on("connection", async (socket, req) => {
        const ws = socket;
        ws.userId = req.userId;
        ws.username = req.username;
        ws.isAlive = true;
        try {
            const user = await prisma.user.findUnique({ where: { id: ws.userId } });
            ws.rating = user?.rating || 1200; // Default to 1200 if not found
        }
        catch (e) {
            ws.rating = 1200;
        }
        console.log(`Player ${ws.username} (Elo: ${ws.rating}) Connected!`);
        ws.on('pong', () => {
            ws.isAlive = true;
        });
        ws.on("message", async (data) => {
            const now = Date.now();
            if (ws.lastActionTime && (now - ws.lastActionTime < 200)) {
                return;
            }
            ws.lastActionTime = now;
            try {
                const parsedMessage = JSON.parse(data.toString());
                switch (parsedMessage.type) {
                    case 'find_match':
                        await (0, matchmaking_1.handleFindMatch)(ws);
                        break;
                    case 'cancel_find_match':
                        const idx = state_1.matchQueue.indexOf(ws);
                        if (idx !== -1) {
                            state_1.matchQueue.splice(idx, 1);
                            ws.queuedAt = undefined;
                        }
                        break;
                    case 'create_private_room':
                        (0, matchmaking_1.handleCreatePrivateRoom)(ws);
                        break;
                    case 'join_private_room':
                        if (!parsedMessage.roomCode) {
                            (0, state_1.sendToClient)(ws, { type: 'error', message: 'Room code required.' });
                            break;
                        }
                        await (0, matchmaking_1.handleJoinPrivateRoom)(ws, parsedMessage.roomCode);
                        break;
                    case 'play_bot':
                        if (!parsedMessage.level) {
                            (0, state_1.sendToClient)(ws, { type: 'error', message: 'Bot level required.' });
                            break;
                        }
                        await (0, matchmaking_1.handlePlayBot)(ws, parsedMessage.level);
                        break;
                    case 'move':
                        await (0, gameplay_1.handleMove)(ws, parsedMessage);
                        break;
                    case 'resign':
                        await (0, gameplay_1.handleResign)(ws);
                        break;
                    case 'draw_offer':
                        (0, gameplay_1.handleDrawOffer)(ws);
                        break;
                    case 'draw_response':
                        await (0, gameplay_1.handleDrawResponse)(ws, parsedMessage.accept);
                        break;
                    case 'leave_room':
                        if (ws.roomId) {
                            const room = state_1.rooms.get(ws.roomId);
                            if (room) {
                                if (!room.game.isGameOver() && !room.dbGameId?.startsWith('done')) {
                                    (0, gameplay_1.handleResign)(ws);
                                }
                            }
                            ws.roomId = undefined;
                        }
                        break;
                    case 'chat':
                        (0, connection_1.handleChat)(ws, parsedMessage.message);
                        break;
                    case 'reconnect':
                        (0, connection_1.handleReconnect)(ws, parsedMessage.roomId, parsedMessage.sessionId);
                        break;
                    case 'join':
                        const joinRoom = state_1.rooms.get(parsedMessage.roomId);
                        if (joinRoom) {
                            if (!joinRoom.spectators)
                                joinRoom.spectators = [];
                            joinRoom.spectators.push(ws);
                            ws.roomId = parsedMessage.roomId;
                            (0, state_1.sendToClient)(ws, { type: 'state', fen: joinRoom.game.fen(), turn: joinRoom.game.turn(), clock: joinRoom.clock });
                        }
                        else {
                            (0, state_1.sendToClient)(ws, { type: 'error', message: 'Room not found' });
                        }
                        break;
                    case 'rematch_offer':
                        if (ws.lastOpponent && ws.lastOpponent.readyState === ws.OPEN) {
                            (0, state_1.sendToClient)(ws.lastOpponent, { type: 'rematch_offered' });
                            (0, state_1.sendToClient)(ws.lastOpponent, { type: 'chat', message: 'Your opponent wants a rematch.' });
                        }
                        break;
                    case 'rematch_accept':
                        if (ws.lastOpponent && ws.lastOpponent.readyState === ws.OPEN) {
                            await (0, matchmaking_1.setupGameRoom)(ws.lastOpponent, ws); // reverse colors naturally by passing opponent first
                        }
                        break;
                }
            }
            catch (error) {
                console.error("Received invalid JSON format");
            }
        });
        ws.on("close", () => {
            if (ws.isBeingReplaced)
                return;
            const queueIndex = state_1.matchQueue.indexOf(ws);
            if (queueIndex !== -1) {
                state_1.matchQueue.splice(queueIndex, 1);
            }
            // If they were hosting a private room, delete it
            for (const [code, host] of state_1.pendingPrivateRooms.entries()) {
                if (host === ws) {
                    state_1.pendingPrivateRooms.delete(code);
                    break;
                }
            }
            if (ws.roomId) {
                const room = state_1.rooms.get(ws.roomId);
                if (room) {
                    if (room.spectators && room.spectators.includes(ws)) {
                        room.spectators = room.spectators.filter(s => s !== ws);
                        return; // Spectators don't trigger disconnect timeouts
                    }
                    const opponent = room.players.find(p => p !== ws);
                    if (opponent) {
                        (0, state_1.sendToClient)(opponent, { type: 'error', message: 'Your opponent disconnected. They have 60 seconds to reconnect.' });
                    }
                    if (!room.disconnectTimeouts)
                        room.disconnectTimeouts = {};
                    const color = ws.color;
                    if (color) {
                        room.disconnectTimeouts[color] = setTimeout(async () => {
                            if (state_1.rooms.has(ws.roomId)) {
                                const currentPlayer = room.players.find(p => p.color === color);
                                // If the current player in the room is STILL this exact disconnected socket,
                                // it means they haven't reconnected (because reconnect replaces the socket)
                                if (currentPlayer === ws) {
                                    const resultMsg = `${color === 'w' ? 'White' : 'Black'} abandoned the game.`;
                                    if (opponent)
                                        (0, state_1.sendToClient)(opponent, { type: 'game_over', result: resultMsg });
                                    if (room.dbGameId) {
                                        await (0, gameplay_2.finalizeGame)(ws.roomId, room.dbGameId, resultMsg, color === 'w' ? 'b' : 'w');
                                    }
                                    state_1.rooms.delete(ws.roomId);
                                }
                            }
                        }, 60000);
                    }
                }
            }
        });
    });
    heartBeatInterval = setInterval(() => {
        wss.clients.forEach((client) => {
            const ws = client;
            if (ws.isAlive === false) {
                console.log(`Terminating ghost connection for ${ws.username} due to missed heartbeat.`);
                ws.terminate();
                return;
            }
            ws.ping();
            ws.isAlive = false;
        });
    }, 30000);
    sweeperInterval = setInterval(async () => {
        const now = Date.now();
        for (const [roomId, room] of state_1.rooms.entries()) {
            const turn = room.game.turn();
            const timeElapsed = now - room.lastMoveTime;
            if (room.clock[turn] - timeElapsed <= 0) {
                console.log(`Room ${roomId}: Player ${turn} flagged!`);
                room.clock[turn] = 0;
                const winner = turn === 'w' ? 'Black' : 'White';
                const resultMessage = `Timeout! ${winner} wins.`;
                room.players.forEach(client => {
                    (0, state_1.sendToClient)(client, { type: 'state', fen: room.game.fen(), turn: turn, clock: room.clock });
                    (0, state_1.sendToClient)(client, { type: 'game_over', result: resultMessage });
                });
                if (room.dbGameId) {
                    const outcome = turn === 'w' ? 'b' : 'w'; // The person whose turn it is flagged, so the OTHER color wins
                    await (0, gameplay_2.finalizeGame)(roomId, room.dbGameId, resultMessage, outcome);
                }
                state_1.rooms.delete(roomId);
            }
            else {
                // Periodic tick sync
                room.players.forEach(client => {
                    (0, state_1.sendToClient)(client, { type: 'state', fen: room.game.fen(), turn: turn, clock: { ...room.clock, [turn]: room.clock[turn] - timeElapsed } });
                });
                if (room.spectators) {
                    room.spectators.forEach(client => {
                        (0, state_1.sendToClient)(client, { type: 'state', fen: room.game.fen(), turn: turn, clock: { ...room.clock, [turn]: room.clock[turn] - timeElapsed } });
                    });
                }
            }
        }
    }, 1000);
    wss.on('close', () => {
        clearInterval(heartBeatInterval);
        clearInterval(sweeperInterval);
    });
}
async function shutdownActiveGames() {
    console.log("Stopping game loops...");
    clearInterval(heartBeatInterval);
    clearInterval(sweeperInterval);
    console.log(`Aborting ${state_1.rooms.size} active games...`);
    for (const [roomId, room] of state_1.rooms.entries()) {
        if (room.botEngine)
            room.botEngine.kill();
        room.players.forEach(client => {
            (0, state_1.sendToClient)(client, { type: 'error', message: 'Server is restarting. Game aborted.' });
            client.terminate();
        });
        if (room.dbGameId) {
            await prisma.game.update({
                where: { id: room.dbGameId },
                data: { status: 'aborted', finishedAt: new Date() }
            });
        }
    }
    state_1.rooms.clear();
}
