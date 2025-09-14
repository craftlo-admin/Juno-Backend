const express = require('express');
const router = express.Router();
const websocketService = require('../services/websocketService');
const { authenticateToken: auth } = require('../middleware/auth');
const logger = require('../utils/logger');

// Get WebSocket connection statistics
router.get('/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    const stats = websocketService.getConnectionStats();
    
    res.json({
      status: 'success',
      data: {
        websocket_stats: stats,
        server_info: {
          uptime: process.uptime(),
          memory_usage: process.memoryUsage(),
          timestamp: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    logger.error('Error getting WebSocket stats:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve WebSocket statistics'
    });
  }
});

// Send system announcement (admin only)
router.post('/announcement', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    const { message, level = 'info' } = req.body;

    if (!message) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Message is required'
      });
    }

    websocketService.sendSystemAnnouncement(message, level);

    res.json({
      status: 'success',
      message: 'System announcement sent successfully'
    });

    logger.info(`System announcement sent by admin ${req.user.userId}: ${message}`);
  } catch (error) {
    logger.error('Error sending system announcement:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to send system announcement'
    });
  }
});

// Send tenant-specific message (admin or tenant owner only)
router.post('/tenant/:tenantId/message', auth, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { message, type = 'info' } = req.body;

    // Check permissions
    if (req.user.role !== 'admin' && req.user.tenantId !== tenantId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied to this tenant'
      });
    }

    if (!message) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Message is required'
      });
    }

    websocketService.sendTenantMessage(tenantId, message, type);

    res.json({
      status: 'success',
      message: 'Tenant message sent successfully'
    });

    logger.info(`Tenant message sent to ${tenantId} by user ${req.user.userId}: ${message}`);
  } catch (error) {
    logger.error('Error sending tenant message:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to send tenant message'
    });
  }
});

// Send notification to specific user (admin only)
router.post('/notification/:userId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    const { userId } = req.params;
    const { title, message, type = 'info', action_url } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Title and message are required'
      });
    }

    const notification = {
      title,
      message,
      type,
      action_url,
      from_user: req.user.userId
    };

    websocketService.sendNotification(userId, notification);

    res.json({
      status: 'success',
      message: 'Notification sent successfully'
    });

    logger.info(`Notification sent to user ${userId} by admin ${req.user.userId}`);
  } catch (error) {
    logger.error('Error sending notification:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to send notification'
    });
  }
});

// Get WebSocket connection guide
router.get('/guide', (req, res) => {
  const guide = {
    websocket_url: `${req.protocol === 'https' ? 'wss' : 'ws'}://${req.get('host')}`,
    authentication: {
      method: 'token',
      description: 'Include JWT token in handshake.auth.token or Authorization header',
      example: {
        'handshake.auth.token': 'your-jwt-token',
        'or': 'headers.authorization: Bearer your-jwt-token'
      }
    },
    available_events: {
      client_to_server: [
        'subscribe:builds - Subscribe to build status updates',
        'subscribe:deployments - Subscribe to deployment updates',
        'subscribe:notifications - Subscribe to user notifications',
        'join:project - Join project collaboration room',
        'leave:project - Leave project collaboration room',
        'ping - Health check ping'
      ],
      server_to_client: [
        'connected - Connection confirmation',
        'build:update - Real-time build status updates',
        'deployment:update - Real-time deployment updates',
        'notification - User notifications',
        'system:announcement - System-wide announcements',
        'tenant:message - Tenant-specific messages',
        'user:joined - User joined project collaboration',
        'user:left - User left project collaboration',
        'pong - Response to ping'
      ]
    },
    rooms: [
      'user:{userId} - Personal notifications',
      'tenant:{tenantId} - Tenant-wide updates',
      'builds:{tenantId} - Build status updates',
      'deployments:{tenantId} - Deployment updates',
      'notifications:{userId} - Personal notifications',
      'project:{projectId} - Project collaboration'
    ],
    example_client_code: {
      javascript: `
const io = require('socket.io-client');
const socket = io('${req.protocol === 'https' ? 'wss' : 'ws'}://${req.get('host')}', {
  auth: {
    token: 'your-jwt-token'
  }
});

socket.on('connected', (data) => {
  console.log('Connected:', data);
  
  // Subscribe to updates
  socket.emit('subscribe:builds');
  socket.emit('subscribe:deployments');
  socket.emit('subscribe:notifications');
});

socket.on('build:update', (data) => {
  console.log('Build update:', data);
});

socket.on('deployment:update', (data) => {
  console.log('Deployment update:', data);
});

socket.on('notification', (data) => {
  console.log('Notification:', data);
});
      `
    }
  };

  res.json({
    status: 'success',
    data: guide
  });
});

module.exports = router;
