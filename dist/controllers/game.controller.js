"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyActiveGame = exports.getActiveGames = exports.getFullGameAnalysis = exports.analyzeGamePosition = exports.getGameById = exports.getMyGames = void 0;
const client_1 = require("@prisma/client");
const stockfish_service_1 = require("../services/stockfish.service");
const analysis_queue_1 = require("../services/analysis.queue");
const zod_1 = require("zod");
const state_1 = require("../ws/state");
const prisma = new client_1.PrismaClient();
const analyzeSchema = zod_1.z.object({
    fen: zod_1.z.string().min(15, "Invalid FEN string")
});
const getMyGames = async (req, res) => {
    try {
        const userId = req.userId;
        const games = await prisma.game.findMany({
            where: {
                OR: [
                    { whitePlayerId: userId },
                    { blackPlayerId: userId }
                ]
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                status: true,
                result: true,
                createdAt: true,
                finishedAt: true,
                whiteRatingChange: true,
                blackRatingChange: true,
                whitePlayerId: true,
                blackPlayerId: true,
                whitePlayer: { select: { username: true } },
                blackPlayer: { select: { username: true } }
            }
        });
        res.json(games);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
};
exports.getMyGames = getMyGames;
const getGameById = async (req, res) => {
    try {
        const id = req.params.id;
        const game = await prisma.game.findUnique({
            where: { id },
            include: {
                whitePlayer: { select: { id: true, username: true } },
                blackPlayer: { select: { id: true, username: true } },
                // Include all moves ordered by moveNumber
                moves: {
                    orderBy: { moveNumber: 'asc' },
                    select: { notation: true, fenAfter: true, createdAt: true }
                }
            }
        });
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        if (game.whitePlayerId !== req.userId && game.blackPlayerId !== req.userId) {
            return res.status(403).json({ error: 'Forbidden: You did not participate in this game' });
        }
        res.json(game);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch game details' });
    }
};
exports.getGameById = getGameById;
const analyzeGamePosition = async (req, res) => {
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.format() });
    }
    // 1. Spawn a dedicated engine instance just for this request
    const engine = new stockfish_service_1.StockfishService();
    try {
        const { fen } = req.body;
        if (!fen) {
            return res.status(400).json({ error: 'Missing FEN string' });
        }
        const analysis = await engine.analyzePosition(fen, 12);
        res.json(analysis);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message || 'Analysis failed' });
    }
    finally {
        // 2. GUARANTEE the process is killed so we don't leak memory
        engine.kill();
    }
};
exports.analyzeGamePosition = analyzeGamePosition;
const getFullGameAnalysis = async (req, res) => {
    try {
        const gameIdString = req.params.id;
        const game = await prisma.game.findUnique({
            where: { id: gameIdString },
            include: { moves: { orderBy: { moveNumber: 'asc' } } }
        });
        if (!game || game.moves.length === 0) {
            return res.status(404).json({ error: 'Game not found or has no moves' });
        }
        if (game.whitePlayerId !== req.userId && game.blackPlayerId !== req.userId) {
            return res.status(403).json({ error: 'Forbidden: You did not participate in this game' });
        }
        // Return immediately if completed
        if (game.analysisStatus === 'completed') {
            return res.json(game.analysis);
        }
        // If pending, tell client to poll
        if (game.analysisStatus === 'pending') {
            return res.json({ status: 'pending' });
        }
        // Otherwise (none or failed), enqueue it
        analysis_queue_1.analysisQueue.add(gameIdString);
        return res.json({ status: 'pending' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to analyze game' });
    }
};
exports.getFullGameAnalysis = getFullGameAnalysis;
const getActiveGames = async (req, res) => {
    try {
        const active = [];
        for (const [roomId, room] of state_1.rooms.entries()) {
            if (!room.game.isGameOver()) {
                const white = room.players.find(p => p.color === 'w');
                const black = room.players.find(p => p.color === 'b');
                active.push({
                    roomId,
                    whitePlayer: white ? white.username : 'Unknown',
                    whiteRating: white ? white.rating : 1200,
                    blackPlayer: black ? black.username : 'Unknown',
                    blackRating: black ? black.rating : 1200,
                    fen: room.game.fen()
                });
            }
        }
        res.json(active);
    }
    catch (e) {
        res.status(500).json({ error: 'Failed to fetch active games' });
    }
};
exports.getActiveGames = getActiveGames;
const getMyActiveGame = async (req, res) => {
    try {
        const userId = req.userId;
        for (const [roomId, room] of state_1.rooms.entries()) {
            if (!room.game.isGameOver()) {
                const myPlayer = room.players.find(p => p.userId === userId);
                if (myPlayer) {
                    const opponent = room.players.find(p => p !== myPlayer);
                    return res.json({
                        roomId,
                        sessionId: myPlayer.sessionId,
                        color: myPlayer.color === 'w' ? 'white' : 'black',
                        opponentName: opponent ? opponent.username : 'Unknown'
                    });
                }
            }
        }
        res.json(null);
    }
    catch (e) {
        res.status(500).json({ error: 'Failed to fetch your active game' });
    }
};
exports.getMyActiveGame = getMyActiveGame;
