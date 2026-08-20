const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'your-local-secret', async (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: decodedUser.userId },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });

      if (!user) {
        return res.status(404).json({ error: 'User no longer exists' });
      }

      if (user.isActive === false) {
        return res.status(403).json({ error: 'User account is inactive' });
      }

      req.user = {
        userId: user.id,
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      };
      next();
    } catch (error) {
      console.error('Authentication middleware error:', error);
      return res.status(500).json({ error: 'Internal server error during authentication' });
    }
  });
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }
  next();
};

module.exports = { authenticateToken, requireAdmin };
