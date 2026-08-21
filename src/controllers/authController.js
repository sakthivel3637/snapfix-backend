const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const DEFAULT_ADMIN_EMAIL = 'admin@gmail.com';
const DEFAULT_ADMIN_PASSWORD = 'Admin@123';

const register = async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Please provide email, password, and name' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        name,
        role: role || 'TESTER',
      },
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_ACCESS_SECRET || 'your-local-secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const isDefaultAdmin = normalizedEmail === DEFAULT_ADMIN_EMAIL.toLowerCase() && password === DEFAULT_ADMIN_PASSWORD;

    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Fallback/auto-recovery: If user is default admin and does not exist in DB yet (e.g. fresh/changed DB)
    if (!user && isDefaultAdmin) {
      const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      user = await prisma.user.create({
        data: {
          email: DEFAULT_ADMIN_EMAIL,
          password: hashedPassword,
          name: 'Admin User',
          role: 'ADMIN',
          isActive: true,
        },
      });
      console.log('Auto-created default admin user on login.');
    }

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // If default admin logging in with default credentials, ensure active and admin role
    if (isDefaultAdmin) {
      if (!user.isActive || user.role !== 'ADMIN') {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { isActive: true, role: 'ADMIN' },
        });
      }
    } else {
      if (user.isActive === false) {
        return res.status(403).json({ error: 'Your account is deactivated. Please contact support.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_ACCESS_SECRET || 'your-local-secret',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const me = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (error) {
    console.error('getUsers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Only admins can change user status' });
    }

    if (isActive === undefined) {
      return res.status(400).json({ error: 'isActive property is required' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.email.toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase() && isActive === false) {
      return res.status(400).json({ error: 'The primary default admin account cannot be deactivated' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('updateUserStatus error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Only admins can delete users' });
    }

    if (req.user.userId === id || req.user.id === id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.email.toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase()) {
      return res.status(400).json({ error: 'The primary default admin account cannot be deleted' });
    }

    // Safely cleanup user dependencies in a transaction before deleting user
    await prisma.$transaction(async (tx) => {
      // 1. Delete feedback assignments involving this user
      await tx.feedbackAssignment.deleteMany({
        where: {
          OR: [{ assigneeId: id }, { assignedById: id }],
        },
      });

      // 2. Delete feedback status histories changed by this user
      await tx.feedbackStatusHistory.deleteMany({
        where: { changedById: id },
      });

      // 3. Delete comments by this user
      await tx.comment.deleteMany({
        where: { userId: id },
      });

      // 4. Delete notifications for this user
      await tx.notification.deleteMany({
        where: { userId: id },
      });

      // 5. Delete project memberships for this user
      await tx.projectMember.deleteMany({
        where: { userId: id },
      });

      // 6. Delete feedbacks created by this user if any
      const userFeedbacks = await tx.feedback.findMany({
        where: { creatorId: id },
        select: { id: true },
      });
      const feedbackIds = userFeedbacks.map((f) => f.id);
      if (feedbackIds.length > 0) {
        await tx.feedbackLabel.deleteMany({
          where: { feedbackId: { in: feedbackIds } },
        });
        await tx.feedbackStatusHistory.deleteMany({
          where: { feedbackId: { in: feedbackIds } },
        });
        await tx.feedbackAssignment.deleteMany({
          where: { feedbackId: { in: feedbackIds } },
        });
        await tx.comment.deleteMany({
          where: { feedbackId: { in: feedbackIds } },
        });
        await tx.notification.deleteMany({
          where: { feedbackId: { in: feedbackIds } },
        });
        await tx.feedback.deleteMany({
          where: { creatorId: id },
        });
      }

      // 7. Delete the user
      await tx.user.delete({
        where: { id },
      });
    });

    res.json({ message: 'User deleted successfully', id });
  } catch (error) {
    console.error('deleteUser error:', error);
    res.status(500).json({ error: 'Internal server error while deleting user' });
  }
};

module.exports = { register, login, me, getUsers, updateUserStatus, deleteUser, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD };


