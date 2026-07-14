import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/httpAuth';
import { StockfishService } from '../services/stockfish.service';

const prisma = new PrismaClient();

export const getMyGames = async (req: AuthRequest, res: Response)=> {
    try {
        const userId = req.userId!;

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
                whitePlayer: { select: { username: true } },
                blackPlayer: { select: { username: true } }
            }
        });

        res.json(games);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
};

export const getGameById = async (req: AuthRequest, res: Response)=> {
    try {
        const id = req.params.id as string;

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
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch game details' });
    }
};

export const analyzeGamePosition = async (req: AuthRequest, res: Response) => {
    // 1. Spawn a dedicated engine instance just for this request
    const engine = new StockfishService();
    
    try {
        const { fen } = req.body;
        if (!fen) {
            return res.status(400).json({ error: 'Missing FEN string' });
        }

        const analysis = await engine.analyzePosition(fen, 12);
        res.json(analysis);
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'Analysis failed' });
    } finally {
        // 2. GUARANTEE the process is killed so we don't leak memory
        engine.kill();
    }
};

export const getFullGameAnalysis = async (req: AuthRequest, res: Response) => {
    // 1. Spawn a dedicated engine instance just for this request
    const engine = new StockfishService();
    
    try {
        const gameIdString = req.params.id as string;

        const game = await prisma.game.findUnique({
            where: { id: gameIdString },
            include: { moves: { orderBy: { moveNumber: 'asc' } } }
        });

        if (!game || game.moves.length === 0) {
            return res.status(404).json({ error: 'Game not found or has no moves' });
        }

        const startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        const fens = [startingFen, ...game.moves.map(m => m.fenAfter)];

        // We can safely iterate using this engine because no other user can access it
        const report = await engine.analyzeFullGame(fens);

        res.json(report);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to analyze game' });
    } finally {
        // 2. GUARANTEE the process is killed
        engine.kill();
    }
};