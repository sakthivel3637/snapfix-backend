const express = require('express');
const router = express.Router();
const integrationController = require('../controllers/integrationController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// All integration endpoints are strictly Admin-only
router.use(authenticateToken);
router.use(requireAdmin);

// Jira integration routes
router.get('/jira', integrationController.getJiraConfig);
router.post('/jira', integrationController.saveJiraConfig);
router.patch('/jira/toggle', integrationController.toggleJiraStatus);
router.post('/jira/test', integrationController.testConnection);
router.delete('/jira', integrationController.deleteJiraConfig);

module.exports = router;
