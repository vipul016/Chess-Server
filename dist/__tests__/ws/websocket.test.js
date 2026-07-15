"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const ws_2 = __importDefault(require("ws"));
const supertest_1 = __importDefault(require("supertest"));
const gameManager_1 = require("../../ws/gameManager");
const wsAuth_1 = require("../../middlewares/wsAuth");
const auth_routes_1 = __importDefault(require("../../routes/auth.routes"));
const game_routes_1 = __importDefault(require("../../routes/game.routes"));
let server;
let wss;
let port;
let token1;
let token2;
function waitForMessage(ws, type) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type || 'any'} message`)), 10000);
        ws.on('message', function handler(data) {
            const msg = JSON.parse(data.toString());
            if (!type || msg.type === type) {
                clearTimeout(timeout);
                ws.off('message', handler);
                resolve(msg);
            }
        });
    });
}
function connectWs(tokenVal) {
    return new Promise((resolve, reject) => {
        const ws = new ws_2.default(`ws://localhost:${port}?token=${tokenVal}`);
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
}
const activeSockets = [];
function trackWs(ws) {
    activeSockets.push(ws);
    return ws;
}
beforeAll(async () => {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use('/auth', auth_routes_1.default);
    app.use('/games', game_routes_1.default);
    server = http_1.default.createServer(app);
    wss = new ws_1.WebSocketServer({ noServer: true });
    (0, gameManager_1.setupWebSockets)(wss);
    server.on('upgrade', (0, wsAuth_1.handleWsUpgrade)(wss));
    await new Promise((resolve) => {
        server.listen(0, () => {
            port = server.address().port;
            resolve();
        });
    });
    // Sign up two test users
    const unique = () => `u_${Math.floor(Math.random() * 1000000)}`;
    const res1 = await (0, supertest_1.default)(app)
        .post('/auth/signup')
        .send({ username: unique(), password: 'password123' });
    token1 = res1.body.token;
    const res2 = await (0, supertest_1.default)(app)
        .post('/auth/signup')
        .send({ username: unique(), password: 'password123' });
    token2 = res2.body.token;
});
afterEach(() => {
    for (const ws of activeSockets) {
        if (ws.readyState === ws_2.default.OPEN || ws.readyState === ws_2.default.CONNECTING) {
            ws.close();
        }
    }
    activeSockets.length = 0;
});
afterAll(async () => {
    wss.close();
    await new Promise((resolve) => server.close(() => resolve()));
});
describe('WebSocket Tests', () => {
    it('connects with valid token', async () => {
        const ws = trackWs(await connectWs(token1));
        expect(ws.readyState).toBe(ws_2.default.OPEN);
    });
    it('rejects connection without token', async () => {
        await expect(new Promise((resolve, reject) => {
            const ws = new ws_2.default(`ws://localhost:${port}`);
            activeSockets.push(ws);
            ws.on('open', () => reject(new Error('Should not have opened')));
            ws.on('error', () => resolve());
            ws.on('close', () => resolve());
            setTimeout(() => resolve(), 3000);
        })).resolves.toBeUndefined();
    });
    it('two players find_match and receive match_found with opposite colors', async () => {
        const ws1 = trackWs(await connectWs(token1));
        const ws2 = trackWs(await connectWs(token2));
        ws1.send(JSON.stringify({ type: 'find_match' }));
        ws2.send(JSON.stringify({ type: 'find_match' }));
        const msg1 = await waitForMessage(ws1, 'match_found');
        const msg2 = await waitForMessage(ws2, 'match_found');
        expect(msg1.type).toBe('match_found');
        expect(msg2.type).toBe('match_found');
        expect(msg1).toHaveProperty('roomId');
        expect(msg2).toHaveProperty('roomId');
        expect(msg1).toHaveProperty('color');
        expect(msg2).toHaveProperty('color');
        const colors = [msg1.color, msg2.color].sort();
        expect(colors).toEqual(['black', 'white']);
    });
    it('after match_found, both receive state with starting FEN', async () => {
        const ws1 = trackWs(await connectWs(token1));
        const ws2 = trackWs(await connectWs(token2));
        ws1.send(JSON.stringify({ type: 'find_match' }));
        ws2.send(JSON.stringify({ type: 'find_match' }));
        await waitForMessage(ws1, 'match_found');
        await waitForMessage(ws2, 'match_found');
        const state1 = await waitForMessage(ws1, 'state');
        const state2 = await waitForMessage(ws2, 'state');
        const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        expect(state1.fen).toBe(startFen);
        expect(state2.fen).toBe(startFen);
        expect(state1.turn).toBe('w');
        expect(state1).toHaveProperty('clock');
    });
    it('valid move updates state for both players', async () => {
        const ws1 = trackWs(await connectWs(token1));
        const ws2 = trackWs(await connectWs(token2));
        ws1.send(JSON.stringify({ type: 'find_match' }));
        ws2.send(JSON.stringify({ type: 'find_match' }));
        const matchMsg1 = await waitForMessage(ws1, 'match_found');
        const matchMsg2 = await waitForMessage(ws2, 'match_found');
        // Wait for initial state
        await waitForMessage(ws1, 'state');
        await waitForMessage(ws2, 'state');
        // Identify the white player
        const whiteWs = matchMsg1.color === 'white' ? ws1 : ws2;
        const blackWs = matchMsg1.color === 'white' ? ws2 : ws1;
        // White makes a move (e2 to e4)
        whiteWs.send(JSON.stringify({ type: 'move', from: 'e2', to: 'e4' }));
        const stateAfterMove1 = await waitForMessage(whiteWs, 'state');
        const stateAfterMove2 = await waitForMessage(blackWs, 'state');
        expect(stateAfterMove1.fen).toContain('e4');
        expect(stateAfterMove1.turn).toBe('b');
        expect(stateAfterMove2.fen).toBe(stateAfterMove1.fen);
    });
    it('move on wrong turn returns error', async () => {
        const ws1 = trackWs(await connectWs(token1));
        const ws2 = trackWs(await connectWs(token2));
        ws1.send(JSON.stringify({ type: 'find_match' }));
        ws2.send(JSON.stringify({ type: 'find_match' }));
        const matchMsg1 = await waitForMessage(ws1, 'match_found');
        await waitForMessage(ws2, 'match_found');
        await waitForMessage(ws1, 'state');
        await waitForMessage(ws2, 'state');
        // The black player tries to move first
        const blackWs = matchMsg1.color === 'white' ? ws2 : ws1;
        blackWs.send(JSON.stringify({ type: 'move', from: 'e7', to: 'e5' }));
        const errorMsg = await waitForMessage(blackWs, 'error');
        expect(errorMsg.message).toBe('Not your turn');
    });
    it('resign sends game_over to both players', async () => {
        const ws1 = trackWs(await connectWs(token1));
        const ws2 = trackWs(await connectWs(token2));
        ws1.send(JSON.stringify({ type: 'find_match' }));
        ws2.send(JSON.stringify({ type: 'find_match' }));
        await waitForMessage(ws1, 'match_found');
        await waitForMessage(ws2, 'match_found');
        await waitForMessage(ws1, 'state');
        await waitForMessage(ws2, 'state');
        ws1.send(JSON.stringify({ type: 'resign' }));
        const gameOver1 = await waitForMessage(ws1, 'game_over');
        const gameOver2 = await waitForMessage(ws2, 'game_over');
        expect(gameOver1.result).toContain('wins by resignation');
        expect(gameOver2.result).toContain('wins by resignation');
    });
    it('chat message is relayed to opponent', async () => {
        const ws1 = trackWs(await connectWs(token1));
        const ws2 = trackWs(await connectWs(token2));
        ws1.send(JSON.stringify({ type: 'find_match' }));
        ws2.send(JSON.stringify({ type: 'find_match' }));
        const matchMsg1 = await waitForMessage(ws1, 'match_found');
        await waitForMessage(ws2, 'match_found');
        await waitForMessage(ws1, 'state');
        await waitForMessage(ws2, 'state');
        ws1.send(JSON.stringify({ type: 'chat', message: 'Hello opponent!' }));
        const chatMsg = await waitForMessage(ws2, 'chat');
        expect(chatMsg.message).toBe('Hello opponent!');
    });
    it('create_private_room returns room_created with 6-char code', async () => {
        const ws = trackWs(await connectWs(token1));
        ws.send(JSON.stringify({ type: 'create_private_room' }));
        const msg = await waitForMessage(ws, 'room_created');
        expect(msg.type).toBe('room_created');
        expect(msg.roomCode).toBeDefined();
        expect(msg.roomCode).toHaveLength(6);
    });
    it('join_private_room with valid code starts game', async () => {
        const ws1 = trackWs(await connectWs(token1));
        const ws2 = trackWs(await connectWs(token2));
        ws1.send(JSON.stringify({ type: 'create_private_room' }));
        const roomMsg = await waitForMessage(ws1, 'room_created');
        ws2.send(JSON.stringify({ type: 'join_private_room', roomCode: roomMsg.roomCode }));
        const matchMsg1 = await waitForMessage(ws1, 'match_found');
        const matchMsg2 = await waitForMessage(ws2, 'match_found');
        expect(matchMsg1).toHaveProperty('roomId');
        expect(matchMsg2).toHaveProperty('roomId');
    });
    it('join_private_room with invalid code returns error', async () => {
        const ws = trackWs(await connectWs(token1));
        ws.send(JSON.stringify({ type: 'join_private_room', roomCode: 'ZZZZZZ' }));
        const errorMsg = await waitForMessage(ws, 'error');
        expect(errorMsg.message).toBe('Invalid or expired room code.');
    });
    it('cancel_find_match removes player from queue', async () => {
        const ws1 = trackWs(await connectWs(token1));
        const ws2 = trackWs(await connectWs(token2));
        // Player 1 joins queue
        ws1.send(JSON.stringify({ type: 'find_match' }));
        // Wait a small delay for queue to register
        await new Promise((r) => setTimeout(r, 500));
        // Player 1 cancels
        ws1.send(JSON.stringify({ type: 'cancel_find_match' }));
        await new Promise((r) => setTimeout(r, 500));
        // Player 2 joins queue - should NOT get a match since player 1 cancelled
        ws2.send(JSON.stringify({ type: 'find_match' }));
        // Wait briefly - no match_found should arrive
        await expect(waitForMessage(ws2, 'match_found')).rejects.toThrow('Timeout');
    }, 15000);
});
