require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/authRoutes');
const projectRoutes = require('./routes/projectRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const userFeedbackRoutes = require('./routes/userFeedbackRoutes');
const { initSocket } = require('./sockets/socketManager');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: '*', // allows both local chrome extension and dev dashboard
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

initSocket(io);

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload directories exist
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const uploadPaths = ['screenshots', 'audio', 'video', 'attachments'];
uploadPaths.forEach((folder) => {
  const dirPath = path.join(UPLOAD_DIR, folder);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created upload directory: ${dirPath}`);
  }
});

// Express Static Routes
app.use('/uploads/screenshots', express.static(path.join(UPLOAD_DIR, 'screenshots')));
app.use('/uploads/audio', express.static(path.join(UPLOAD_DIR, 'audio')));
app.use('/uploads/video', express.static(path.join(UPLOAD_DIR, 'video')));
app.use('/uploads/attachments', express.static(path.join(UPLOAD_DIR, 'attachments')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/user-feedbacks', userFeedbackRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;
const bcrypt = require('bcryptjs');
const prisma = require('./config/db');

const seedAdminUser = async () => {
  try {
    const adminEmail = 'admin@gmail.com';
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      const hashedPassword = await bcrypt.hash('Admin@123', 10);
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
      console.log('Default admin user already exists.');
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

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await seedAdminUser();
});
