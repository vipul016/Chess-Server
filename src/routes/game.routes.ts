import { Router } from 'express';
import { getMyGames, getGameById } from '../controllers/game.controller';
import { requireAuth } from '../middlewares/httpAuth';
import { getFullGameAnalysis,analyzeGamePosition } from '../controllers/game.controller';
import rateLimit from 'express-rate-limit';

const analyzeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10, 
    message: { error: 'Too many analysis requests. Please try again later.' }
});

const router = Router();

router.get('/', requireAuth, getMyGames);
router.get('/:id', requireAuth, getGameById);
router.get('/:id/analyze', requireAuth, analyzeLimiter, getFullGameAnalysis);
router.post('/analyze', requireAuth, analyzeLimiter, analyzeGamePosition);

export default router;