import { Router } from 'express';
import { getProfile, updateProfile } from '../controllers/user.controller';
import { requireAuth } from '../middlewares/httpAuth';

const router = Router();

router.put('/me', requireAuth, updateProfile);
router.get('/:username', getProfile);

export default router;
