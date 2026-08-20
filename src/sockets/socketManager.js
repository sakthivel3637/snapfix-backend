let ioInstance = null;

const initSocket = (io) => {
  ioInstance = io;
  io.on('connection', (socket) => {
    console.log('Socket client connected:', socket.id);

    socket.on('join-project', (projectId) => {
      socket.join(projectId);
      console.log(`Socket ${socket.id} joined project room: ${projectId}`);
    });

    socket.on('join-feedback', (feedbackId) => {
      socket.join(feedbackId);
      console.log(`Socket ${socket.id} joined feedback room: ${feedbackId}`);
    });

    socket.on('disconnect', () => {
      console.log('Socket client disconnected:', socket.id);
    });
  });
};

const getIO = () => {
  return ioInstance;
};

// Emit real-time notification
const sendNotification = (userId, notification) => {
  if (ioInstance) {
    // Send to specific user (or broadcast generally for simplicity if user-specific channels are complex)
    ioInstance.emit(`notification-${userId}`, notification);
    ioInstance.emit('notification-received', notification);
  }
};

const notifyFeedbackUpdate = (feedbackId, eventType, data) => {
  if (ioInstance) {
    ioInstance.to(feedbackId).emit('feedback-updated', { eventType, data });
    // Also notify project channels
    if (data.projectId) {
      ioInstance.to(data.projectId).emit('project-feedback-updated', { eventType, data });
    }
    // General emit
    ioInstance.emit('any-feedback-updated', { feedbackId, eventType, data });
  }
};

module.exports = {
  initSocket,
  getIO,
  sendNotification,
  notifyFeedbackUpdate,
};
