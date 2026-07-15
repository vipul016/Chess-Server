"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChat = handleChat;
exports.handleReconnect = handleReconnect;
const state_1 = require("../state");
function handleChat(ws, message) {
    if (!ws.roomId)
        return;
    const room = state_1.rooms.get(ws.roomId);
    if (!room)
        return;
    const opponent = room.players.find(p => p !== ws);
    if (opponent) {
        (0, state_1.sendToClient)(opponent, { type: 'chat', message });
    }
    if (room.spectators) {
        room.spectators.forEach(s => {
            (0, state_1.sendToClient)(s, { type: 'chat', message });
        });
    }
}
function handleReconnect(ws, roomId, sessionId) {
    const room = state_1.rooms.get(roomId);
    if (!room) {
        (0, state_1.sendToClient)(ws, { type: 'error', message: 'Room no longer exists.' });
        return;
    }
    const ghostIndex = room.players.findIndex(p => p.sessionId === sessionId);
    if (ghostIndex === -1) {
        (0, state_1.sendToClient)(ws, { type: 'error', message: 'Invalid Session ID.' });
        return;
    }
    const ghost = room.players[ghostIndex];
    if (ghost.userId !== ws.userId) {
        (0, state_1.sendToClient)(ws, { type: 'error', message: 'Unauthorized: Identity mismatch.' });
        return;
    }
    ws.roomId = roomId;
    ws.color = ghost.color;
    ws.sessionId = sessionId;
    room.players[ghostIndex] = ws;
    ghost.isBeingReplaced = true;
    ghost.terminate();
    if (room.disconnectTimeouts && ws.color && room.disconnectTimeouts[ws.color]) {
        clearTimeout(room.disconnectTimeouts[ws.color]);
        delete room.disconnectTimeouts[ws.color];
    }
    const colorString = ws.color === 'w' ? 'white' : 'black';
    const whitePlayer = room.players.find(p => p.color === 'w');
    const blackPlayer = room.players.find(p => p.color === 'b');
    const playersInfo = {
        white: { username: whitePlayer?.username || 'Unknown', rating: whitePlayer?.rating || 1200 },
        black: { username: blackPlayer?.username || 'Unknown', rating: blackPlayer?.rating || 1200 }
    };
    (0, state_1.sendToClient)(ws, { type: 'room_joined', color: colorString, sessionId: sessionId, players: playersInfo });
    (0, state_1.sendToClient)(ws, { type: 'state', fen: room.game.fen(), turn: room.game.turn(), clock: room.clock });
    const opponent = room.players.find(p => p !== ws);
    if (opponent) {
        (0, state_1.sendToClient)(opponent, { type: 'chat', message: 'Your opponent reconnected!' });
    }
}
