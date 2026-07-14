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
    rating: number;
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

export const matchQueue: ChessWebSocket[] = [];

export const pendingPrivateRooms = new Map();

// Shared utility
export function sendToClient(ws: WebSocket, message: ServerMessage) {
    ws.send(JSON.stringify(message));
}