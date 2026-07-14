import { WebSocket } from 'ws';
import { Chess } from 'chess.js';
import { ServerMessage } from '../types';

export interface ChessWebSocket extends WebSocket {
    isAlive: boolean;
    sessionId?: string;
    userId?: string;     
    username?: string;   
    color?: 'w' | 'b';
    roomId?: string;     
    isBeingReplaced?: boolean;
    lastActionTime?: number;
}

export interface Room {
    players: ChessWebSocket[];
    game: Chess;
    dbGameId?: string;
    clock: { w: number; b: number };
    lastMoveTime: number;
}

// Global in-memory state
export const rooms = new Map<string, Room>();

// We use an object for the queue so we can mutate the reference across different files
export const matchQueue: { waitingPlayer: ChessWebSocket | null } = { 
    waitingPlayer: null 
};

// Shared utility
export function sendToClient(ws: WebSocket, message: ServerMessage) {
    ws.send(JSON.stringify(message));
}