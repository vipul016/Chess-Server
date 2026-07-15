"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const gameManager_1 = require("./ws/gameManager");
const wsAuth_1 = require("./middlewares/wsAuth");
const game_routes_1 = __importDefault(require("./routes/game.routes"));
const gameManager_2 = require("./ws/gameManager");
const analysis_queue_1 = require("./services/analysis.queue");
const client_1 = require("@prisma/client");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const prisma = new client_1.PrismaClient();
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    message: { error: 'Too many requests from this IP. Please try again later.' }
});
// 1. Middleware
app.use((0, cors_1.default)({
    origin: function (origin, callback) {
        // Dynamically reflect the incoming origin to bypass CORS issues for good
        callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express_1.default.json());
// 2. HTTP Routes
app.use('/auth', authLimiter, auth_routes_1.default);
app.use('/games', game_routes_1.default);
app.use('/users', user_routes_1.default);
// 3. WebSocket Initialization
const wss = new ws_1.WebSocketServer({ noServer: true });
(0, gameManager_1.setupWebSockets)(wss);
// 4. Bind the Custom Upgrade Middleware
server.on('upgrade', (0, wsAuth_1.handleWsUpgrade)(wss));
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
            analysis_queue_1.analysisQueue.add(game.id);
        }
    }
});
const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    // 1. Stop accepting new HTTP connections
    server.close(() => {
        console.log('HTTP server closed.');
    });
    // 2. Abort active games, notify clients, and stop loops
    await (0, gameManager_2.shutdownActiveGames)();
    // 3. Disconnect from PostgreSQL cleanly
    await prisma.$disconnect();
    console.log('Database connection closed.');
    // 4. Exit the process successfully
    console.log('Shutdown complete.');
    process.exit(0);
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
