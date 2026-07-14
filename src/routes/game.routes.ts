import { Router } from 'express';
import { getMyGames, getGameById } from '../controllers/game.controller';
import { requireAuth } from '../middlewares/httpAuth';
import { getFullGameAnalysis,analyzeGamePosition } from '../controllers/game.controller';

const router = Router();

router.get('/', requireAuth, getMyGames);
router.get('/:id', requireAuth, getGameById);
router.get('/:id/analyze', requireAuth, getFullGameAnalysis);
router.post('/analyze', requireAuth, analyzeGamePosition);

export default router;