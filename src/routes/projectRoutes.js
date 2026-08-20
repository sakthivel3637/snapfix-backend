const express = require('express');
const {
  getProjects,
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
  addMember,
} = require('../controllers/projectController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.get('/', getProjects);
router.post('/', requireAdmin, createProject);
router.get('/:id', getProjectById);
router.put('/:id', requireAdmin, updateProject);
router.delete('/:id', requireAdmin, deleteProject);
router.post('/:id/members', requireAdmin, addMember);

module.exports = router;
