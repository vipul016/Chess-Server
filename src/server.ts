import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import authRoutes from './routes/auth.routes';
import { setupWebSockets } from './ws/gameManager';
import { handleWsUpgrade } from './middlewares/wsAuth'; 
import gameRoutes from './routes/game.routes';

dotenv.config();

const app = express();
const server = http.createServer(app);

// 1. Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true 
}));
app.use(express.json());

// 2. HTTP Routes
app.use('/auth', authRoutes);
app.use('/games', gameRoutes);

// 3. WebSocket Initialization
const wss = new WebSocketServer({ noServer: true });
setupWebSockets(wss);

// 4. Bind the Custom Upgrade Middleware
server.on('upgrade', handleWsUpgrade(wss));

// 5. Start Server
server.listen(8080, () => {
    console.log("♟️ Hybrid REST & WebSocket Server running on http://localhost:8080");
});