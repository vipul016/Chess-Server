import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/httpAuth';
import { stockfish } from '../services/stockfish.service';

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

        res.json(game);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch game details' });
    }
};

export const getFullGameAnalysis = async (req: AuthRequest, res: Response) => {
    try {
        const gameIdString = req.params.id as string;

        // 1. Fetch the game and all its moves from PostgreSQL
        const game = await prisma.game.findUnique({
            where: { id: gameIdString },
            include: { moves: { orderBy: { moveNumber: 'asc' } } }
        });

        if (!game || game.moves.length === 0) {
            return res.status(404).json({ error: 'Game not found or has no moves' });
        }

        // 2. Extract just the FEN strings (we add the starting board FEN at the beginning)
        const startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        const fens = [startingFen, ...game.moves.map(m => m.fenAfter)];

        // 3. Run the engine (This will take a few seconds!)
        const report = await stockfish.analyzeFullGame(fens);

        res.json(report);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to analyze game' });
    }
};