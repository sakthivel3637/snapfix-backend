const prisma = require('../config/db');
const { sendNotification } = require('../sockets/socketManager');
const jiraService = require('../services/jiraService');

const getProjects = async (req, res) => {
  try {
    // Return projects where user is a member, or all projects if user is ADMIN
    let projects;
    if (req.user.role === 'ADMIN') {
      projects = await prisma.project.findMany({
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
        },
      });
    } else {
      projects = await prisma.project.findMany({
        where: {
          members: {
            some: { userId: req.user.userId },
          },
        },
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
        },
      });
    }
    res.json(projects);
  } catch (error) {
    console.error('getProjects error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createProject = async (req, res) => {
  try {
    const { name, description, key } = req.body;
    if (!name || !key) {
      return res.status(400).json({ error: 'Name and unique Key are required' });
    }

    // Convert key to uppercase to satisfy Jira's requirement of uppercase alphanumeric characters
    const uppercaseKey = key.trim().toUpperCase();

    const existing = await prisma.project.findUnique({ where: { key: uppercaseKey } });
    if (existing) {
      return res.status(400).json({ error: 'Project key already exists' });
    }

    const project = await prisma.project.create({
      data: {
        name,
        description,
        key: uppercaseKey,
        members: {
          create: {
            userId: req.user.userId,
            role: 'TESTER',
          },
        },
      },
      include: {
        members: true,
      },
    });

    // Create the project in Jira (non-blocking for local creation)
    if (jiraService.isJiraEnabled()) {
      try {
        await jiraService.createJiraProject(uppercaseKey, name, description);
      } catch (jiraErr) {
        console.error('Failed to create/sync project in Jira:', jiraErr);
      }
    }

    res.status(201).json(project);
  } catch (error) {
    console.error('createProject error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
        feedbacks: {
          include: {
            creator: { select: { id: true, name: true, email: true } },
            screenshot: true,
            voiceRecording: true,
            videoRecording: {
              include: {
                videoScreenshots: {
                  include: {
                    screenshot: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Restrict voice recording visibility on each feedback in the project by user role
    if (project.feedbacks && Array.isArray(project.feedbacks)) {
      project.feedbacks = project.feedbacks.map((fb) => {
        if (fb.voiceRecording) {
          const vr = fb.voiceRecording;
          const visibleTo = vr.visibleTo || [];
          if (visibleTo.length > 0) {
            const isCreator = fb.creatorId === req.user.userId;
            const isAdmin = fb.creatorId === req.user.userId || req.user.role === 'ADMIN'; // Wait, let's keep it consistent: isCreator, isAdmin, isRoleAllowed
            const isRoleAllowed = visibleTo.includes(req.user.role);

            if (!isCreator && req.user.role !== 'ADMIN' && !isRoleAllowed) {
              fb.voiceRecording = null;
            }
          }
        }
        return fb;
      });
    }

    res.json(project);
  } catch (error) {
    console.error('getProjectById error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const project = await prisma.project.update({
      where: { id },
      data: { name, description },
    });

    res.json(project);
  } catch (error) {
    console.error('updateProject error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.project.delete({ where: { id } });
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('deleteProject error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const addMember = async (req, res) => {
  try {
    const { id } = req.params; // projectId
    const { userId, role } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const member = await prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: id,
          userId,
        },
      },
      update: { role: role || 'MEMBER' },
      create: {
        projectId: id,
        userId,
        role: role || 'MEMBER',
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    const project = await prisma.project.findUnique({
      where: { id },
      select: { name: true },
    });

    if (userId !== req.user.userId && project) {
      const notif = await prisma.notification.create({
        data: {
          userId,
          title: 'Assigned to Project',
          message: `You have been assigned to project "${project.name}" by Admin ${req.user.name}.`,
        },
      });
      sendNotification(userId, notif);
    }

    res.json(member);
  } catch (error) {
    console.error('addMember error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getProjects,
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
  addMember,
};
