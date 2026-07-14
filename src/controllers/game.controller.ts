import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/httpAuth';

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
        const { id  } = req.params;

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