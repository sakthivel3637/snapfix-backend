const express = require('express');
const {
  createFeedback,
  getFeedbacks,
  getFeedbackById,
  updateFeedback,
  deleteFeedback,
  updateStatus,
  assignFeedback,
  updateLabels,
  addComment,
  getComments,
  uploadProofScreenshot,
} = require('../controllers/feedbackController');
const { authenticateToken } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.get('/', getFeedbacks);
router.post('/', createFeedback);
router.get('/:id', getFeedbackById);
router.put('/:id', updateFeedback);
router.delete('/:id', deleteFeedback);

// Sub-routes
router.post('/:id/status', updateStatus);
router.post('/:id/assign', assignFeedback);
router.post('/:id/labels', updateLabels);
router.get('/:id/comments', getComments);
router.post('/:id/comments', addComment);

// Proof screenshot (Multer config field name 'proof')
router.post('/:id/proof', upload.single('proof'), uploadProofScreenshot);

module.exports = router;
