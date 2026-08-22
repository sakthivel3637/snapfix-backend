const prisma = require('../config/db');
const { sendNotification, notifyFeedbackUpdate } = require('../sockets/socketManager');
const jiraService = require('../services/jiraService');

const createFeedback = async (req, res) => {
  try {
    const {
      projectId,
      title,
      description,
      expectedResult,
      actualResult,
      stepsToReproduce,
      priority,
      url,
      pageTitle,
      browser,
      os,
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
      pinX,
      pinY,
      elementTag,
      elementId,
      elementClasses,
      cssSelector,
      elementText,
      screenshotId,
      voiceRecordingId,
      videoRecordingId,
      videoScreenshots, // Array of { screenshotId, timestamp }
      labels, // Array of label names or IDs
    } = req.body;

    if (!projectId || !title) {
      return res.status(400).json({ error: 'Project ID and Title are required' });
    }

    // Create feedback
    const feedback = await prisma.feedback.create({
      data: {
        projectId,
        title,
        description,
        expectedResult,
        actualResult,
        stepsToReproduce,
        priority: priority || 'MEDIUM',
        status: 'OPEN',
        url: url || '',
        pageTitle,
        browser,
        os,
        viewportWidth: viewportWidth ? parseInt(viewportWidth) : null,
        viewportHeight: viewportHeight ? parseInt(viewportHeight) : null,
        devicePixelRatio: devicePixelRatio ? parseFloat(devicePixelRatio) : null,
        pinX: pinX ? parseFloat(pinX) : null,
        pinY: pinY ? parseFloat(pinY) : null,
        elementTag,
        elementId,
        elementClasses,
        cssSelector,
        elementText,
        screenshotId,
        voiceRecordingId,
        videoRecordingId,
        creatorId: req.user.userId,
      },
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
    });

    // Create VideoScreenshot relations if provided
    if (videoScreenshots && Array.isArray(videoScreenshots) && videoRecordingId) {
      for (const item of videoScreenshots) {
        if (item.screenshotId) {
          await prisma.videoScreenshot.create({
            data: {
              videoRecordingId,
              screenshotId: item.screenshotId,
              timestamp: parseFloat(item.timestamp) || 0,
              title: item.title || null,
              description: item.description || null,
            },
          });
        }
      }
    }

    // Record status history
    await prisma.feedbackStatusHistory.create({
      data: {
        feedbackId: feedback.id,
        status: 'OPEN',
        changedById: req.user.userId,
      },
    });

    // Associate labels if provided
    if (labels && Array.isArray(labels)) {
      for (const labelName of labels) {
        // Find or create label
        const label = await prisma.label.upsert({
          where: { name: labelName },
          update: {},
          create: { name: labelName },
        });

        await prisma.feedbackLabel.create({
          data: {
            feedbackId: feedback.id,
            labelId: label.id,
          },
        });
      }
    }

    // Notify project members via Socket & Notification db
    const members = await prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });

    for (const member of members) {
      if (member.userId !== req.user.userId) {
        const notif = await prisma.notification.create({
          data: {
            userId: member.userId,
            feedbackId: feedback.id,
            title: 'New Feedback Created',
            message: `New feedback "${title}" has been reported in project.`,
          },
        });
        sendNotification(member.userId, notif);
      }
    }

    // Sync with Jira if configured
    if (jiraService.isJiraEnabled()) {
      try {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { key: true },
        });

        if (project && project.key) {
          const jiraIssueKey = await jiraService.createJiraIssue(project.key, title, {
            creatorName: req.user.name,
            creatorEmail: req.user.email,
            url,
            os,
            browser,
            viewportWidth,
            viewportHeight,
            devicePixelRatio,
            description,
            expectedResult,
            actualResult,
            stepsToReproduce,
            feedbackId: feedback.id,
          });

          if (jiraIssueKey) {
            await prisma.feedback.update({
              where: { id: feedback.id },
              data: { jiraIssueKey },
            });
            feedback.jiraIssueKey = jiraIssueKey;

            // Upload attachments in the background (failures won't crash the api response)
            try {
              if (feedback.screenshot && feedback.screenshot.originalPath) {
                await jiraService.uploadAttachment(jiraIssueKey, feedback.screenshot.originalPath);
              }
              if (feedback.voiceRecording && feedback.voiceRecording.filePath) {
                await jiraService.uploadAttachment(jiraIssueKey, feedback.voiceRecording.filePath);
              }
              if (feedback.videoRecording && feedback.videoRecording.filePath) {
                await jiraService.uploadAttachment(jiraIssueKey, feedback.videoRecording.filePath);
              }
            } catch (attachErr) {
              console.error('Error uploading attachments to Jira:', attachErr);
            }
          }
        }
      } catch (jiraErr) {
        console.error('Failed to sync feedback with Jira:', jiraErr);
      }
    }

    notifyFeedbackUpdate(feedback.id, 'CREATE', feedback);

    res.status(201).json(feedback);
  } catch (error) {
    console.error('createFeedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getFeedbacks = async (req, res) => {
  try {
    const { projectId, status, priority } = req.query;

    const filter = {};
    if (projectId) filter.projectId = projectId;
    if (status) {
      filter.status = status;
    } else {
      filter.status = { not: 'CLOSED' };
    }
    if (priority) filter.priority = priority;

    // Check permissions: only list projects the user belongs to (unless ADMIN)
    if (req.user.role !== 'ADMIN') {
      const userProjects = await prisma.projectMember.findMany({
        where: { userId: req.user.userId },
        select: { projectId: true },
      });
      const projectIds = userProjects.map((p) => p.projectId);
      if (projectId && !projectIds.includes(projectId)) {
        return res.status(403).json({ error: 'Access denied to this project' });
      }
      filter.projectId = { in: projectIds };
    }

    const feedbacks = await prisma.feedback.findMany({
      where: filter,
      include: {
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
        screenshot: true,
        assignments: {
          include: { assignee: { select: { id: true, name: true } } },
        },
        labels: {
          include: { label: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const dynamicJiraHost = jiraService.getJiraHost();
    const enrichedFeedbacks = feedbacks.map((fb) => ({
      ...fb,
      jiraIssueUrl: fb.jiraIssueKey && dynamicJiraHost
        ? `${dynamicJiraHost}/browse/${fb.jiraIssueKey}`
        : null,
    }));

    res.json(enrichedFeedbacks);
  } catch (error) {
    console.error('getFeedbacks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getFeedbackById = async (req, res) => {
  try {
    const { id } = req.params;

    const feedback = await prisma.feedback.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            members: {
              include: {
                user: {
                  select: { id: true, name: true, role: true }
                }
              }
            }
          }
        },
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
        labels: {
          include: { label: true },
        },
        comments: {
          include: {
            user: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        statusHistory: {
          include: {
            changedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        assignments: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            assignedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    // Restrict voice recording visibility by user role
    if (feedback.voiceRecording) {
      const vr = feedback.voiceRecording;
      const visibleTo = vr.visibleTo || [];
      if (visibleTo.length > 0) {
        const isCreator = feedback.creatorId === req.user.userId;
        const isAdmin = req.user.role === 'ADMIN';
        const isRoleAllowed = visibleTo.includes(req.user.role);

        if (!isCreator && !isAdmin && !isRoleAllowed) {
          feedback.voiceRecording = null;
        }
      }
    }

    const dynamicJiraHost = jiraService.getJiraHost();
    const jiraIssueUrl = feedback.jiraIssueKey && dynamicJiraHost
      ? `${dynamicJiraHost}/browse/${feedback.jiraIssueKey}`
      : null;

    res.json({ ...feedback, jiraIssueUrl });
  } catch (error) {
    console.error('getFeedbackById error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, expectedResult, actualResult, stepsToReproduce, priority } = req.body;

    const feedback = await prisma.feedback.update({
      where: { id },
      data: {
        title,
        description,
        expectedResult,
        actualResult,
        stepsToReproduce,
        priority,
      },
    });

    notifyFeedbackUpdate(feedback.id, 'UPDATE', feedback);
    res.json(feedback);
  } catch (error) {
    console.error('updateFeedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.feedback.delete({ where: { id } });
    notifyFeedbackUpdate(id, 'DELETE', { id });
    res.json({ message: 'Feedback deleted successfully' });
  } catch (error) {
    console.error('deleteFeedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    if (['VERIFIED', 'REOPENED', 'CLOSED'].includes(status)) {
      if (req.user.role !== 'TESTER' && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden: Only testers and admins can verify, reopen, or close feedback' });
      }
    }

    const currentFeedback = await prisma.feedback.findUnique({
      where: { id },
      select: { status: true, creatorId: true, title: true, screenshotId: true, screenshot: true, projectId: true },
    });

    if (!currentFeedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    if (status === 'REOPENED' && currentFeedback.screenshotId && currentFeedback.screenshot?.fixedPath) {
      const fs = require('fs');
      const path = require('path');
      const fixedPath = currentFeedback.screenshot.fixedPath;
      const filename = path.basename(fixedPath);
      const UPLOAD_DIR = process.env.UPLOAD_DIR
        ? path.resolve(process.env.UPLOAD_DIR)
        : path.resolve(__dirname, '..', '..', 'uploads');
      const fullPath = path.join(UPLOAD_DIR, 'screenshots', filename);

      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (unlinkError) {
          console.error('Error deleting fixed screenshot file:', unlinkError);
        }
      }

      await prisma.screenshot.update({
        where: { id: currentFeedback.screenshotId },
        data: { fixedPath: null },
      });
    }

    const updatedFeedback = await prisma.feedback.update({
      where: { id },
      data: { status },
      include: { screenshot: true },
    });

    // Create history
    await prisma.feedbackStatusHistory.create({
      data: {
        feedbackId: id,
        status,
        changedById: req.user.userId,
      },
    });

    // Notify creator if they are still a member of the project
    if (currentFeedback.creatorId !== req.user.userId) {
      const creatorMembership = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: currentFeedback.projectId,
            userId: currentFeedback.creatorId,
          },
        },
      });
      if (creatorMembership) {
        const notif = await prisma.notification.create({
          data: {
            userId: currentFeedback.creatorId,
            feedbackId: id,
            title: 'Feedback Status Updated',
            message: `Your feedback "${currentFeedback.title}" status changed to ${status}.`,
          },
        });
        sendNotification(currentFeedback.creatorId, notif);
      }
    }

    notifyFeedbackUpdate(id, 'STATUS_CHANGE', updatedFeedback);
    res.json(updatedFeedback);
  } catch (error) {
    console.error('updateStatus error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const assignFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { assigneeId } = req.body;

    if (!assigneeId) {
      return res.status(400).json({ error: 'Assignee User ID is required' });
    }

    const feedback = await prisma.feedback.findUnique({
      where: { id },
      select: { title: true, projectId: true },
    });

    if (!feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    // Role check: Only TESTER and ADMIN can assign feedback
    if (req.user.role !== 'TESTER' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Only testers and admins can assign feedback' });
    }

    // Validate assignee role (must be DEVELOPER)
    const assigneeUser = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: { role: true },
    });

    if (!assigneeUser) {
      return res.status(400).json({ error: 'Assignee user not found' });
    }

    if (assigneeUser.role !== 'DEVELOPER') {
      return res.status(400).json({ error: 'Assignee must be a Developer' });
    }

    // Validate assignee is a member of the feedback's project
    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: feedback.projectId,
          userId: assigneeId,
        },
      },
    });

    if (!membership) {
      return res.status(400).json({ error: 'Assignee must be a member of the feedback project' });
    }

    const assignment = await prisma.feedbackAssignment.create({
      data: {
        feedbackId: id,
        assigneeId,
        assignedById: req.user.userId,
      },
      include: {
        assignee: { select: { id: true, name: true } },
      },
    });

    // Create in-app notification for assignee
    if (assigneeId !== req.user.userId) {
      const notif = await prisma.notification.create({
        data: {
          userId: assigneeId,
          feedbackId: id,
          title: 'Feedback Assigned to You',
          message: `You have been assigned to feedback "${feedback.title}".`,
        },
      });
      sendNotification(assigneeId, notif);
    }

    notifyFeedbackUpdate(id, 'ASSIGNMENT', assignment);
    res.json(assignment);
  } catch (error) {
    console.error('assignFeedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateLabels = async (req, res) => {
  try {
    const { id } = req.params;
    const { labelNames } = req.body; // Array of string names

    if (!labelNames || !Array.isArray(labelNames)) {
      return res.status(400).json({ error: 'labelNames array is required' });
    }

    // Delete existing relation
    await prisma.feedbackLabel.deleteMany({
      where: { feedbackId: id },
    });

    // Create new relations
    for (const name of labelNames) {
      const label = await prisma.label.upsert({
        where: { name },
        update: {},
        create: { name },
      });

      await prisma.feedbackLabel.create({
        data: {
          feedbackId: id,
          labelId: label.id,
        },
      });
    }

    const updated = await prisma.feedback.findUnique({
      where: { id },
      include: {
        labels: { include: { label: true } },
      },
    });

    notifyFeedbackUpdate(id, 'LABELS_UPDATE', updated);
    res.json(updated);
  } catch (error) {
    console.error('updateLabels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, parentId } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const comment = await prisma.comment.create({
      data: {
        feedbackId: id,
        userId: req.user.userId,
        parentId: parentId || null,
        text,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    // Get feedback project and users to notify
    const fb = await prisma.feedback.findUnique({
      where: { id },
      select: { projectId: true, creatorId: true, title: true, assignments: { take: 1, orderBy: { createdAt: 'desc' } } },
    });

    if (fb) {
      // Parse mentions (e.g. @UserName or @user@domain.com)
      const mentionRegex = /@(\w+)/g;
      const matches = text.match(mentionRegex);
      const notifiedUserIds = new Set();

      if (matches) {
        for (const match of matches) {
          const username = match.substring(1);
          const user = await prisma.user.findFirst({
            where: { name: { equals: username, mode: 'insensitive' } },
          });

          if (user && user.id !== req.user.userId) {
            // Check if mentioned user is a member of this project
            const isMember = await prisma.projectMember.findUnique({
              where: {
                projectId_userId: {
                  projectId: fb.projectId,
                  userId: user.id,
                },
              },
            });

            if (isMember) {
              const notif = await prisma.notification.create({
                data: {
                  userId: user.id,
                  feedbackId: id,
                  title: 'Mentioned in Comment',
                  message: `${req.user.name} mentioned you in a comment.`,
                },
              });
              sendNotification(user.id, notif);
              notifiedUserIds.add(user.id);
            }
          }
        }
      }

      // Also notify assignee or creator if they are project members and haven't been notified yet
      const notifyUsers = new Set();
      if (fb.creatorId !== req.user.userId && !notifiedUserIds.has(fb.creatorId)) {
        notifyUsers.add(fb.creatorId);
      }
      if (fb.assignments.length > 0 && fb.assignments[0].assigneeId !== req.user.userId && !notifiedUserIds.has(fb.assignments[0].assigneeId)) {
        notifyUsers.add(fb.assignments[0].assigneeId);
      }

      for (const uid of notifyUsers) {
        // Check if user is a member of the project
        const isMember = await prisma.projectMember.findUnique({
          where: {
            projectId_userId: {
              projectId: fb.projectId,
              userId: uid,
            },
          },
        });

        if (isMember) {
          const notif = await prisma.notification.create({
            data: {
              userId: uid,
              feedbackId: id,
              title: 'New Comment Added',
              message: `${req.user.name} commented on "${fb.title}".`,
            },
          });
          sendNotification(uid, notif);
        }
      }
    }

    notifyFeedbackUpdate(id, 'COMMENT_ADD', comment);
    res.status(201).json(comment);
  } catch (error) {
    console.error('addComment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getComments = async (req, res) => {
  try {
    const { id } = req.params;
    const comments = await prisma.comment.findMany({
      where: { feedbackId: id },
      include: {
        user: { select: { id: true, name: true } },
        replies: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(comments);
  } catch (error) {
    console.error('getComments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const uploadProofScreenshot = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'No proof screenshot uploaded' });
    }

    const fixedPath = `/uploads/screenshots/${req.file.filename}`;

    const feedback = await prisma.feedback.findUnique({
      where: { id },
      include: { screenshot: true },
    });

    if (!feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    let updatedScreenshot;
    if (feedback.screenshotId) {
      updatedScreenshot = await prisma.screenshot.update({
        where: { id: feedback.screenshotId },
        data: { fixedPath },
      });
    } else {
      updatedScreenshot = await prisma.screenshot.create({
        data: {
          originalPath: fixedPath, // default if original didn't exist
          fixedPath,
        },
      });
      await prisma.feedback.update({
        where: { id },
        data: { screenshotId: updatedScreenshot.id },
      });
    }

    notifyFeedbackUpdate(id, 'PROOF_UPLOAD', updatedScreenshot);
    res.json(updatedScreenshot);
  } catch (error) {
    console.error('uploadProofScreenshot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createFeedback,
  getFeedbacks,
  getFeedbackById,
  updateFeedback,
  deleteFeedback,
  updateStatus,
  assignFeedback,
  updateLabels,
  addComment,
  getComments,
  uploadProofScreenshot,
};
