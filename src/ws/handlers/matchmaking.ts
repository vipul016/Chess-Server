// src/ws/handlers/matchmaking.ts
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { Chess } from 'chess.js';
import { ChessWebSocket, rooms, matchQueue, pendingPrivateRooms, sendToClient } from '../state';

const prisma = new PrismaClient();

// Helper to handle the actual room creation and DB setup to avoid repeating code
export async function setupGameRoom(player1: ChessWebSocket, player2: ChessWebSocket) {
    const roomId = crypto.randomUUID(); 

    rooms.set(roomId, {
        players: [player1, player2],
        game: new Chess(),
        clock: { w: 600000, b: 600000 }, 
        lastMoveTime: Date.now()         
    });

    const room = rooms.get(roomId)!;
    
    player1.roomId = roomId;
    player1.color = 'w';
    player1.sessionId = crypto.randomUUID();
    player1.lastOpponent = player2;
    
    player2.roomId = roomId;
    player2.color = 'b';
    player2.sessionId = crypto.randomUUID();
    player2.lastOpponent = player1;

    const dbGame = await prisma.game.create({
        data: { 
            status: 'active',
            whitePlayerId: player1.userId!,
            blackPlayerId: player2.userId!
        }
    });
    room.dbGameId = dbGame.id;

    sendToClient(player1, { type: 'match_found', roomId, color: 'white' });
    sendToClient(player2, { type: 'match_found', roomId, color: 'black' });

    const startingState = {
        type: 'state' as const,
        fen: room.game.fen(),
        turn: room.game.turn(),
        clock: room.clock
    };
    sendToClient(player1, startingState);
    sendToClient(player2, startingState);

    console.log(`Match created: Room ${roomId}`);
}

export async function handleFindMatch(ws: ChessWebSocket) {
    // 1. Clean up any dead connections in the queue
    for (let i = matchQueue.length - 1; i >= 0; i--) {
        if (matchQueue[i].readyState !== ws.OPEN) {
            matchQueue.splice(i, 1);
        }
    }

    // Prevent double-queueing
    if (matchQueue.includes(ws)) return;

    // 2. Look for an opponent within a widening Elo range
    const timeWaiting = Date.now() - (ws.queuedAt || Date.now());
    const ELO_THRESHOLD = 200 + Math.floor(timeWaiting / 5000) * 50; // Widen 50 points every 5 seconds
    let matchIndex = -1;

    for (let i = 0; i < matchQueue.length; i++) {
        const potentialOpponent = matchQueue[i];
        if (Math.abs(potentialOpponent.rating - ws.rating) <= ELO_THRESHOLD) {
            matchIndex = i;
            break;
        }
    }

    // 3. If match found, remove from queue and start game
    if (matchIndex !== -1) {
        const opponent = matchQueue.splice(matchIndex, 1)[0];
        await setupGameRoom(opponent, ws);
    } else {
        // 4. If no match, add to queue
        ws.queuedAt = ws.queuedAt || Date.now();
        matchQueue.push(ws);
        console.log(`Player ${ws.username} (Elo: ${ws.rating}) joined matchmaking queue...`);
    }
}

export function handleCreatePrivateRoom(ws: ChessWebSocket) {
    // Generate a simple 6-character alphanumeric code
    const roomCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    
    pendingPrivateRooms.set(roomCode, ws);
    
    sendToClient(ws, { type: 'room_created', roomCode });
    console.log(`Player ${ws.username} created private room: ${roomCode}`);
}

export async function handleJoinPrivateRoom(ws: ChessWebSocket, roomCode: string) {
    const host = pendingPrivateRooms.get(roomCode);

    if (!host) {
        sendToClient(ws, { type: 'error', message: 'Invalid or expired room code.' });
        return;
    }

    if (host.readyState !== ws.OPEN) {
        pendingPrivateRooms.delete(roomCode);
        sendToClient(ws, { type: 'error', message: 'The host has disconnected.' });
        return;
    }

    if (host === ws) {
        sendToClient(ws, { type: 'error', message: 'You cannot join your own room.' });
        return;
    }

    // Remove from pending map and start the game!
    pendingPrivateRooms.delete(roomCode);
    await setupGameRoom(host, ws);
}