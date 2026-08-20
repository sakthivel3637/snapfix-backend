const prisma = require('../config/db');

// Create user feedback (Any logged-in user can submit)
const createUserFeedback = async (req, res) => {
  try {
    const { name, title, description } = req.body;

    if (!name || !title || !description) {
      return res.status(400).json({ error: 'Name, title, and description are required' });
    }

    const feedback = await prisma.userFeedback.create({
      data: {
        name,
        title,
        description,
      },
    });

    res.status(201).json(feedback);
  } catch (error) {
    console.error('Error creating user feedback:', error);
    res.status(500).json({ error: 'Failed to create user feedback' });
  }
};

// Get all user feedbacks (ADMIN only)
const getUserFeedbacks = async (req, res) => {
  try {
    const feedbacks = await prisma.userFeedback.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json(feedbacks);
  } catch (error) {
    console.error('Error fetching user feedbacks:', error);
    res.status(500).json({ error: 'Failed to fetch user feedbacks' });
  }
};

// Get feedback by ID (ADMIN only)
const getUserFeedbackById = async (req, res) => {
  try {
    const { id } = req.params;
    const feedback = await prisma.userFeedback.findUnique({
      where: { id },
    });

    if (!feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    res.json(feedback);
  } catch (error) {
    console.error('Error fetching user feedback detail:', error);
    res.status(500).json({ error: 'Failed to fetch user feedback detail' });
  }
};

// Update user feedback (ADMIN only)
const updateUserFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, title, description } = req.body;

    const existing = await prisma.userFeedback.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    const updated = await prisma.userFeedback.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existing.name,
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating user feedback:', error);
    res.status(500).json({ error: 'Failed to update user feedback' });
  }
};

// Delete user feedback (ADMIN only)
const deleteUserFeedback = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.userFeedback.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    await prisma.userFeedback.delete({
      where: { id },
    });

    res.json({ message: 'Feedback successfully deleted' });
  } catch (error) {
    console.error('Error deleting user feedback:', error);
    res.status(500).json({ error: 'Failed to delete user feedback' });
  }
};

module.exports = {
  createUserFeedback,
  getUserFeedbacks,
  getUserFeedbackById,
  updateUserFeedback,
  deleteUserFeedback,
};
