require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const prisma = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const projectRoutes = require('./src/routes/projectRoutes');
const feedbackRoutes = require('./src/routes/feedbackRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const userFeedbackRoutes = require('./src/routes/userFeedbackRoutes');
const integrationRoutes = require('./src/routes/integrationRoutes');
const { initSocket } = require('./src/sockets/socketManager');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  },
});

initSocket(io);

// Global Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure upload directories exist (resolves absolute path reliably)
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, 'uploads');

const uploadPaths = ['screenshots', 'audio', 'video', 'attachments'];
uploadPaths.forEach((folder) => {
  const dirPath = path.join(UPLOAD_DIR, folder);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created upload directory: ${dirPath}`);
  }
});

// Express Static Routes (available under both /uploads and /api/uploads for reverse proxy flexibility)
const staticScreenshotHandler = express.static(path.join(UPLOAD_DIR, 'screenshots'));
const staticAudioHandler = express.static(path.join(UPLOAD_DIR, 'audio'));
const staticVideoHandler = express.static(path.join(UPLOAD_DIR, 'video'));
const staticAttachmentHandler = express.static(path.join(UPLOAD_DIR, 'attachments'));

app.use(['/uploads/screenshots', '/api/uploads/screenshots'], staticScreenshotHandler);
app.use(['/uploads/audio', '/api/uploads/audio'], staticAudioHandler);
app.use(['/uploads/video', '/api/uploads/video'], staticVideoHandler);
app.use(['/uploads/attachments', '/api/uploads/attachments'], staticAttachmentHandler);

// Health check route (supported with and without /api prefixes)
app.get(['/health', '/api/health', '/api/api/health', '/api/auth/health', '/api/api/auth/health'], (req, res) => {
  res.json({ status: 'ok', server: 'snapfix-backend', time: new Date() });
});

// Modular API Router
const apiRouter = express.Router();
apiRouter.use('/auth', authRoutes);
apiRouter.use('/projects', projectRoutes);
apiRouter.use('/feedback', feedbackRoutes);
apiRouter.use('/uploads', uploadRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/user-feedbacks', userFeedbackRoutes);
apiRouter.use('/integrations', integrationRoutes);

// Mount router at BOTH '/api' and '/' (handles reverse proxies that strip or retain the /api prefix)
app.use('/api', apiRouter);
app.use('/', apiRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack || err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;

const seedAdminUser = async () => {
  try {
    const adminEmail = 'admin@gmail.com';
    const adminPassword = 'Admin@123';
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await prisma.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          name: 'Admin User',
          role: 'ADMIN',
          isActive: true,
        },
      });
      console.log('Successfully seeded default admin user (admin@gmail.com).');
    } else {
      if (existing.role !== 'ADMIN' || existing.isActive === false) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: 'ADMIN', isActive: true },
        });
        console.log('Default admin user updated to ensure ADMIN role and active status.');
      } else {
        console.log('Default admin user already exists and is active.');
      }
    }

    // Cleanup orphaned notifications where feedback has been deleted
    const deleteCount = await prisma.notification.deleteMany({
      where: {
        feedbackId: null,
      },
    });
    if (deleteCount.count > 0) {
      console.log(`Cleaned up ${deleteCount.count} orphaned notifications.`);
    }
  } catch (error) {
    console.error('Error seeding default admin user & cleaning notifications:', error);
  }
};

// Start listening if executed directly
if (require.main === module || !process.env.PASSENGER_APP_ENV) {
  server.listen(PORT, async () => {
    console.log(`SnapFix backend server running on port ${PORT} (entry: snapfixapp.js)`);
    await seedAdminUser();
  });
} else {
  // Support Passenger / Phusion server hooks if required
  seedAdminUser().catch(console.error);
}

module.exports = { app, server };
