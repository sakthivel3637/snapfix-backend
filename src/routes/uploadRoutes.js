const express = require('express');
const {
  uploadScreenshot,
  uploadAudio,
  uploadVideo,
  uploadAttachment,
} = require('../controllers/uploadController');
const { authenticateToken } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.post('/screenshot', upload.single('screenshot'), uploadScreenshot);
router.post('/audio', upload.single('audio'), uploadAudio);
router.post('/video', upload.single('video'), uploadVideo);
router.post('/attachment', upload.single('attachment'), uploadAttachment);

module.exports = router;
