import { ChessWebSocket, rooms, sendToClient } from '../state';

export function handleChat(ws: ChessWebSocket, message: string) {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    const opponent = room.players.find(p => p !== ws);
    if (opponent) {
        sendToClient(opponent, { type: 'chat', message });
    }
}

export function handleReconnect(ws: ChessWebSocket, roomId: string, sessionId: string) {
    const room = rooms.get(roomId);
    
    if (!room) {
        sendToClient(ws, { type: 'error', message: 'Room no longer exists.' });
        return;
    }

    const ghostIndex = room.players.findIndex(p => p.sessionId === sessionId);
    
    if (ghostIndex === -1) {
        sendToClient(ws, { type: 'error', message: 'Invalid Session ID.' });
        return;
    }
    
    const ghost = room.players[ghostIndex];
    
    if (ghost.userId !== ws.userId) {
        sendToClient(ws, { type: 'error', message: 'Unauthorized: Identity mismatch.' });
        return;
    }
    ws.roomId = roomId;
    ws.color = ghost.color;
    ws.sessionId = sessionId;
    
    room.players[ghostIndex] = ws;

    ghost.isBeingReplaced = true;
    ghost.terminate();

    const colorString = ws.color === 'w' ? 'white' : 'black';
    sendToClient(ws, { type: 'room_joined', color: colorString, sessionId: sessionId });
    sendToClient(ws, { type: 'state', fen: room.game.fen(), turn: room.game.turn(), clock: room.clock });

    const opponent = room.players.find(p => p !== ws);
    if (opponent) {
        sendToClient(opponent, { type: 'chat', message: 'Your opponent reconnected!' });
    }
}