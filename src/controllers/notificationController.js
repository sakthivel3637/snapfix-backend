const prisma = require('../config/db');

const getNotifications = async (req, res) => {
  try {
    // Retrieve all active projects to filter out orphaned notifications
    const allProjects = await prisma.project.findMany({
      select: { name: true },
    });
    const activeProjectNames = allProjects.map((p) => p.name);

    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.user.userId,
        OR: [
          { feedbackId: null },
          {
            feedback: {
              project: {
                members: {
                  some: { userId: req.user.userId },
                },
              },
            },
          },
        ],
      },
      include: {
        feedback: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter out and identify notifications referencing deleted projects
    const orphanedIds = [];
    const validNotifications = notifications.filter((n) => {
      const match = n.message.match(/project "([^"]+)"/i);
      if (match && match[1]) {
        const projectName = match[1];
        if (!activeProjectNames.includes(projectName)) {
          orphanedIds.push(n.id);
          return false;
        }
      }
      return true;
    });

    // Clean up orphaned notifications in background
    if (orphanedIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: orphanedIds } },
      }).catch((e) => console.error('Error cleaning orphaned notifications:', e));
    }

    res.json(validNotifications);
  } catch (error) {
    console.error('getNotifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.json(notification);
  } catch (error) {
    console.error('markAsRead error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: {
        userId: req.user.userId,
        isRead: false,
      },
      data: { isRead: true },
    });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('markAllAsRead error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
};
