"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = require("../controllers/user.controller");
const httpAuth_1 = require("../middlewares/httpAuth");
const router = (0, express_1.Router)();
router.put('/me', httpAuth_1.requireAuth, user_controller_1.updateProfile);
router.get('/:username', user_controller_1.getProfile);
exports.default = router;
