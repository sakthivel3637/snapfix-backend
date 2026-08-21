const express = require('express');
const { register, login, me, getUsers, updateUserStatus, deleteUser } = require('../controllers/authController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', authenticateToken, requireAdmin, register);
router.post('/login', login);
router.get('/me', authenticateToken, me);
router.get('/users', authenticateToken, getUsers);
router.put('/users/:id/status', authenticateToken, updateUserStatus);
router.delete('/users/:id', authenticateToken, requireAdmin, deleteUser);

module.exports = router;
