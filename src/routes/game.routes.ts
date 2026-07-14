import { Router } from 'express';
import { getMyGames, getGameById } from '../controllers/game.controller';
import { requireAuth } from '../middlewares/httpAuth';

const router = Router();

router.get('/', requireAuth, getMyGames);
router.get('/:id', requireAuth, getGameById);

export default router;