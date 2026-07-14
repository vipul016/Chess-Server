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
import { analysisQueue } from './services/analysis.queue';
import { PrismaClient } from '@prisma/client';


dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const prisma = new PrismaClient();


const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10000, 
    message: { error: 'Too many requests from this IP. Please try again later.' }
});

// 1. Middleware
app.use(cors({
    origin: function (origin, callback) {
        // Dynamically reflect the incoming origin to bypass CORS issues for good
        callback(null, true);
    },
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
server.listen(PORT, async () => {
    console.log("♟️ Hybrid REST & WebSocket Server running on http://localhost:8080");

    // Recover any pending analysis tasks from previous crashes
    const pendingGames = await prisma.game.findMany({
        where: { analysisStatus: 'pending' },
        select: { id: true }
    });
    if (pendingGames.length > 0) {
        console.log(`Recovering ${pendingGames.length} pending analysis tasks...`);
        for (const game of pendingGames) {
            analysisQueue.add(game.id);
        }
    }
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