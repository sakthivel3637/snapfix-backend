const express = require('express');
const {
  createUserFeedback,
  getUserFeedbacks,
  getUserFeedbackById,
  updateUserFeedback,
  deleteUserFeedback,
} = require('../controllers/userFeedbackController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply authentication token verification globally to these routes
router.use(authenticateToken);

// Create user feedback (Any logged-in user can submit feedback)
router.post('/', createUserFeedback);

// Admin-only management endpoints
router.get('/', requireAdmin, getUserFeedbacks);
router.get('/:id', requireAdmin, getUserFeedbackById);
router.put('/:id', requireAdmin, updateUserFeedback);
router.delete('/:id', requireAdmin, deleteUserFeedback);

module.exports = router;
