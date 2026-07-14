import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import authRoutes from './routes/auth.routes';
import { setupWebSockets } from './ws/gameManager';
import { handleWsUpgrade } from './middlewares/wsAuth'; 
import gameRoutes from './routes/game.routes';
import { shutdownActiveGames } from './ws/gameManager';
import { PrismaClient } from '@prisma/client';


dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT;
const prisma = new PrismaClient();


const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 20, 
    message: { error: 'Too many requests from this IP. Please try again later.' }
});

// 1. Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true 
}));
app.use(express.json());

// 2. HTTP Routes
app.use('/auth',authLimiter,authRoutes);
app.use('/games', gameRoutes);

// 3. WebSocket Initialization
const wss = new WebSocketServer({ noServer: true });
setupWebSockets(wss);

// 4. Bind the Custom Upgrade Middleware
server.on('upgrade', handleWsUpgrade(wss));

// 5. Start Server
server.listen(PORT, () => {
    console.log("♟️ Hybrid REST & WebSocket Server running on http://localhost:8080");
});

const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    // 1. Stop accepting new HTTP connections
    server.close(() => {
        console.log('HTTP server closed.');
    });

    // 2. Abort active games, notify clients, and stop loops
    await shutdownActiveGames();

    // 3. Disconnect from PostgreSQL cleanly
    await prisma.$disconnect();
    console.log('Database connection closed.');

    // 4. Exit the process successfully
    console.log('Shutdown complete.');
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));