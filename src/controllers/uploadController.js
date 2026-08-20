const prisma = require('../config/db');

const uploadScreenshot = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No screenshot file uploaded' });
    }

    const originalPath = `/uploads/screenshots/${req.file.filename}`;
    const screenshot = await prisma.screenshot.create({
      data: {
        originalPath,
      },
    });

    res.status(201).json(screenshot);
  } catch (error) {
    console.error('uploadScreenshot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const uploadAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const filePath = `/uploads/audio/${req.file.filename}`;
    const duration = req.body.duration ? parseFloat(req.body.duration) : 0;

    let visibleTo = [];
    if (req.body.visibleTo) {
      try {
        visibleTo = JSON.parse(req.body.visibleTo);
        if (!Array.isArray(visibleTo)) {
          visibleTo = [visibleTo];
        }
      } catch (e) {
        if (typeof req.body.visibleTo === 'string') {
          visibleTo = req.body.visibleTo.split(',').map(r => r.trim()).filter(Boolean);
        }
      }
    }

    const voiceRecording = await prisma.voiceRecording.create({
      data: {
        filePath,
        duration,
        visibleTo,
      },
    });

    res.status(201).json(voiceRecording);
  } catch (error) {
    console.error('uploadAudio error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const filePath = `/uploads/video/${req.file.filename}`;
    const duration = req.body.duration ? parseFloat(req.body.duration) : 0;

    const videoRecording = await prisma.videoRecording.create({
      data: {
        filePath,
        duration,
      },
    });

    res.status(201).json(videoRecording);
  } catch (error) {
    console.error('uploadVideo error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const uploadAttachment = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No attachment file uploaded' });
    }
    const filePath = `/uploads/attachments/${req.file.filename}`;
    res.status(201).json({ filePath });
  } catch (error) {
    console.error('uploadAttachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  uploadScreenshot,
  uploadAudio,
  uploadVideo,
  uploadAttachment,
};
