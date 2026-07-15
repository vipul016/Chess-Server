import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middlewares/httpAuth';
import { z } from 'zod';

const prisma = new PrismaClient();

const updateProfileSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be under 20 characters").optional(),
    bio: z.string().max(160, "Bio must be under 160 characters").optional(),
    password: z.string().min(6, "Password must be at least 6 characters").max(100).optional(),
});

export const getProfile = async (req: Request, res: Response) => {
    try {
        const username = req.params.username as string;
        const user = await prisma.user.findUnique({ 
            where: { username },
            select: {
                id: true,
                username: true,
                rating: true,
                wins: true,
                losses: true,
                draws: true,
                bio: true,
                createdAt: true,
            }
        });

        if (!user) return res.status(404).json({ error: "User not found" });

        const recentGames = await prisma.game.findMany({
            where: {
                status: 'finished',
                OR: [
                    { whitePlayerId: user.id },
                    { blackPlayerId: user.id }
                ]
            },
            include: {
                whitePlayer: { select: { username: true, rating: true } },
                blackPlayer: { select: { username: true, rating: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        res.json({ user, recentGames });
    } catch (e) {
        res.status(500).json({ error: "Server error" });
    }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
    try {
        const parsed = updateProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }

        const { username, bio, password } = parsed.data;
        const updates: any = {};

        if (username) {
            const existing = await prisma.user.findUnique({ where: { username } });
            if (existing && existing.id !== req.userId) {
                return res.status(400).json({ error: "Username already taken" });
            }
            updates.username = username;
        }

        if (bio !== undefined) {
            updates.bio = bio;
        }

        if (password) {
            updates.passwordHash = await bcrypt.hash(password, 10);
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: "No fields provided to update" });
        }

        const updatedUser = await prisma.user.update({
            where: { id: req.userId },
            data: updates,
            select: { id: true, username: true, bio: true }
        });

        res.json({ message: "Profile updated successfully", user: updatedUser });
    } catch (e) {
        res.status(500).json({ error: "Server error" });
    }
};
