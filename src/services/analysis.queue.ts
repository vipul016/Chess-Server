import { PrismaClient } from '@prisma/client';
import { StockfishService } from './stockfish.service';

const prisma = new PrismaClient();

class AnalysisQueue {
    private queue: string[] = [];
    private isProcessing: boolean = false;

    // Enqueue a game for background analysis
    public async add(gameId: string) {
        // Prevent duplicate queueing
        if (this.queue.includes(gameId)) {
            return;
        }

        // Mark as pending in DB
        await prisma.game.update({
            where: { id: gameId },
            data: { analysisStatus: 'pending' }
        });

        this.queue.push(gameId);
        
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    private async processQueue(): Promise<void> {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const gameId = this.queue.shift();

        if (!gameId) {
            this.isProcessing = false;
            return;
        }

        console.log(`Starting background analysis for game ${gameId}`);
        const engine = new StockfishService();

        try {
            // 1. Fetch Game and Moves
            const game = await prisma.game.findUnique({
                where: { id: gameId },
                include: { moves: { orderBy: { moveNumber: 'asc' } } }
            });

            if (!game || game.moves.length === 0) {
                await prisma.game.update({
                    where: { id: gameId },
                    data: { analysisStatus: 'failed' }
                });
                engine.kill();
                // Process next
                return this.processQueue();
            }

            // 2. Prepare FENs
            const startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            const fens = [startingFen, ...game.moves.map((m: any) => m.fenAfter)];

            // 3. Analyze
            const report = await engine.analyzeFullGame(fens);

            // 4. Save to DB
            await prisma.game.update({
                where: { id: gameId },
                data: {
                    analysisStatus: 'completed',
                    analysis: report as any // Save JSON
                }
            });
            console.log(`Completed background analysis for game ${gameId}`);

        } catch (error) {
            console.error(`Analysis failed for game ${gameId}:`, error);
            await prisma.game.update({
                where: { id: gameId },
                data: { analysisStatus: 'failed' }
            });
        } finally {
            engine.kill();
            // Process next item in queue
            this.processQueue();
        }
    }
}

export const analysisQueue = new AnalysisQueue();
