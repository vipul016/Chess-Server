// src/ws/gameManager.ts
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '../types';
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extending the base WebSocket to hold our custom game state and auth data
interface ChessWebSocket extends WebSocket {
    isAlive: boolean;
    sessionId?: string;
    userId?: string;     // Injected by our Auth Middleware
    username?: string;   // Injected by our Auth Middleware
    color?: 'w' | 'b';
    roomId?: string;     // Attached directly to the socket to prevent closure traps
    isBeingReplaced?: boolean;
}

interface Room {
    players: ChessWebSocket[];
    game: Chess;
    dbGameId?: string;
}

const rooms = new Map<string, Room>();

function sendToClient(ws: WebSocket, message: ServerMessage) {
    ws.send(JSON.stringify(message));
}

export function setupWebSockets(wss: WebSocketServer) {
    // The global matchmaking queue for this server instance
    let waitingPlayer: ChessWebSocket | null = null; 

    wss.on("connection", (socket: WebSocket, req: any) => {
        const ws = socket as ChessWebSocket;
        
        // 1. Hydrate socket with Auth data from the Upgrade Middleware
        ws.userId = req.userId;
        ws.username = req.username;
        ws.isAlive = true;
        
        console.log(`Player ${ws.username} Connected!`);

        // 2. Heartbeat listener
        ws.on('pong', () => { 
            ws.isAlive = true; 
        });

        // 3. Main Message Handler
        ws.on("message", async (data) => {
            try {
                const parsedMessage = JSON.parse(data.toString()) as ClientMessage;
                
                switch (parsedMessage.type) {
                    
                    case 'find_match': {
                        // If someone is already in the queue, pair them up!
                        if (waitingPlayer) {
                            // Prevent a user from matching against themselves if they click twice
                            if (waitingPlayer === ws) return; 

                            const roomId = crypto.randomUUID(); 

                            rooms.set(roomId, {
                                players: [waitingPlayer, ws],
                                game: new Chess()
                            });

                            const room = rooms.get(roomId)!;
                            
                            // SET STATE ON PLAYER 1 (The one who was waiting)
                            waitingPlayer.roomId = roomId;
                            waitingPlayer.color = 'w';
                            waitingPlayer.sessionId = crypto.randomUUID();
                            
                            // SET STATE ON PLAYER 2 (The one who just connected)
                            ws.roomId = roomId;
                            ws.color = 'b';
                            ws.sessionId = crypto.randomUUID();

                            // Save the new Game to the Database with actual User IDs
                            const dbGame = await prisma.game.create({
                                data: { 
                                    status: 'active',
                                    whitePlayerId: waitingPlayer.userId,
                                    blackPlayerId: ws.userId
                                }
                            });
                            room.dbGameId = dbGame.id;

                            // Notify both players that the match is starting
                            sendToClient(waitingPlayer, { type: 'match_found', roomId, color: 'white' });
                            sendToClient(ws, { type: 'match_found', roomId, color: 'black' });

                            // Broadcast initial board state
                            const startingState = {
                                type: 'state' as const,
                                fen: room.game.fen(),
                                turn: room.game.turn()
                            };
                            sendToClient(waitingPlayer, startingState);
                            sendToClient(ws, startingState);

                            // Clear the waiting room now that they are paired
                            waitingPlayer = null; 
                            console.log(`Match created: Room ${roomId}`);
                        } 
                        // If the queue is empty, this player becomes the waiting player
                        else {
                            waitingPlayer = ws;
                            console.log(`Player ${ws.username} is waiting for a match...`);
                        }
                        break;
                    }

                    case 'move': {
                        if (!ws.roomId) break;
                        
                        const room = rooms.get(ws.roomId);
                        if (!room) return;
                        
                        const currTurn = room.game.turn();
                        if (!currTurn) break;
                        
                        // Validate it is actually this player's turn
                        if (currTurn !== ws.color) {
                            sendToClient(ws, { type: 'error', message: 'Not your turn' });
                            break;
                        }
                        
                        try {
                            // chess.js handles all complex chess logic (en passant, castling, etc.)
                            const moveResult = room.game.move({ 
                                from: parsedMessage.from, 
                                to: parsedMessage.to,
                                promotion: parsedMessage.promotion || 'q'
                            });

                            if (!moveResult) {
                                sendToClient(ws, { type: 'error', message: 'Illegal move' });
                                break;
                            }

                            const newFen = room.game.fen();
                            const turn = room.game.turn();

                            // Broadcast the new board state to both players
                            room.players.forEach(client => {
                                sendToClient(client, { type: 'state', fen: newFen, turn: turn });
                            });

                            // Save the move to PostgreSQL
                            if (room.dbGameId) {
                                const history = room.game.history();
                                await prisma.move.create({
                                    data: {
                                        gameId: room.dbGameId,
                                        moveNumber: history.length,
                                        notation: history[history.length - 1],
                                        fenAfter: newFen
                                    }
                                });
                            }
                            
                            // Check for Checkmate, Stalemate, or Draws
                            if (room.game.isGameOver()) {
                                let resultMessage = "Game Over";
                                if (room.game.isCheckmate()) {
                                    const winner = turn === 'b' ? 'White' : 'Black'; 
                                    resultMessage = `Checkmate! ${winner} wins.`;
                                } else if (room.game.isDraw() || room.game.isStalemate() || room.game.isThreefoldRepetition()) {
                                    resultMessage = "Draw!";
                                }
                                
                                room.players.forEach(client => {
                                    sendToClient(client, { type: 'game_over', result: resultMessage });
                                });
                                
                                // Finalize the game in the Database
                                if (room.dbGameId) {
                                    await prisma.game.update({
                                        where: { id: room.dbGameId },
                                        data: {
                                            status: 'finished',
                                            result: resultMessage,
                                            finishedAt: new Date()
                                        }
                                    });
                                }
                                
                                // Cleanup room from memory
                                rooms.delete(ws.roomId);
                            }
                        } catch (error) {
                            sendToClient(ws, { type: 'error', message: 'Move execution failed' });
                        }
                        break;
                    }

                    case 'chat': {
                        if (!ws.roomId) break;
                        const room = rooms.get(ws.roomId);
                        if (!room) break;

                        const opponent = room.players.find(p => p !== ws);
                        if (opponent) {
                            sendToClient(opponent, { type: 'chat', message: parsedMessage.message });
                        }
                        break;
                    }

                    case 'reconnect': {
                        const { roomId, sessionId } = parsedMessage;
                        const room = rooms.get(roomId);
                        
                        if (!room) {
                            sendToClient(ws, { type: 'error', message: 'Room no longer exists.' });
                            break;
                        }

                        const ghostIndex = room.players.findIndex(p => p.sessionId === sessionId);
                        
                        if (ghostIndex === -1) {
                            sendToClient(ws, { type: 'error', message: 'Invalid Session ID.' });
                            break;
                        }
                        
                        const ghost = room.players[ghostIndex];
                        
                        // Hydrate the new socket with the ghost's game state
                        ws.roomId = roomId;
                        ws.color = ghost.color;
                        ws.sessionId = sessionId;
                        
                        // Swap the connections
                        room.players[ghostIndex] = ws;

                        // Safely terminate the old connection
                        ghost.isBeingReplaced = true;
                        ghost.terminate();

                        // Send the user the current state to catch them up
                        const colorString = ws.color === 'w' ? 'white' : 'black';
                        sendToClient(ws, { type: 'room_joined', color: colorString, sessionId: sessionId });
                        sendToClient(ws, { type: 'state', fen: room.game.fen(), turn: room.game.turn() });

                        // Let the opponent know they returned
                        const opponent = room.players.find(p => p !== ws);
                        if (opponent) {
                            sendToClient(opponent, { type: 'chat', message: 'Your opponent reconnected!' });
                        }
                        break;
                    }
                }
            } catch (error) {
                console.error("Received invalid JSON format");
            }
        });

        // 4. Disconnect Handler
        ws.on("close", () => {
            if (ws.isBeingReplaced) return; // Ignore if we are just swapping out a ghost
            
            // If the player was in the matchmaking queue, remove them so a ghost doesn't get paired
            if (waitingPlayer === ws) {
                waitingPlayer = null;
                console.log(`Waiting player ${ws.username} disconnected. Queue cleared.`);
            }

            console.log(`Player ${ws.username} Disconnected`);
            
            // If the player was in an active room, alert the opponent
            if (ws.roomId) {
                const room = rooms.get(ws.roomId);
                if (room) {
                    room.players = room.players.filter(client => client !== ws);
                    
                    room.players.forEach(client => {
                        sendToClient(client, { type: 'error', message: 'Your opponent disconnected.' });
                    });
                    
                    // If both players are gone, delete the room
                    if (room.players.length === 0) {
                        rooms.delete(ws.roomId);
                    }
                }
            }
        });
    });

    // 5. Heartbeat Interval (Cleans up silent disconnects)
    const heartBeatInterval = setInterval(() => {
        wss.clients.forEach((client) => {
            const ws = client as ChessWebSocket;
            if (ws.isAlive === false) {
                console.log(`Terminating ghost connection for ${ws.username} due to missed heartbeat.`);
                ws.terminate();
                return;
            }
            ws.ping();
            ws.isAlive = false;
        });
    }, 30000);

    wss.on('close', () => clearInterval(heartBeatInterval));
}