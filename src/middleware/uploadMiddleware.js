const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure directories exist
const dirs = [
  path.join(UPLOAD_DIR, 'screenshots'),
  path.join(UPLOAD_DIR, 'audio'),
  path.join(UPLOAD_DIR, 'video'),
  path.join(UPLOAD_DIR, 'attachments'),
];

dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'attachments';
    if (file.fieldname === 'screenshot' || file.fieldname === 'proof') {
      folder = 'screenshots';
    } else if (file.fieldname === 'audio') {
      folder = 'audio';
    } else if (file.fieldname === 'video') {
      folder = 'video';
    }
    cb(null, path.join(UPLOAD_DIR, folder));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

module.exports = upload;
