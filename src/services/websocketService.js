const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

class WebSocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socket info
    this.tenantRooms = new Map(); // tenantId -> Set of socketIds
  }

  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? [process.env.FRONTEND_BASE_URL, `https://*.${process.env.BASE_DOMAIN}`]
          : true,
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    
    logger.info('WebSocket service initialized');
    return this.io;
  }

  setupMiddleware() {
    // Authentication middleware for socket connections
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        socket.tenantId = decoded.tenantId;
        socket.role = decoded.role;
        
        logger.info(`WebSocket authentication successful for user ${decoded.userId}`);
        next();
      } catch (error) {
        logger.warn('WebSocket authentication failed:', error.message);
        next(new Error('Authentication failed'));
      }
    });
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  handleConnection(socket) {
    const { userId, tenantId, role } = socket;
    
    logger.info(`User ${userId} connected via WebSocket`);

    // Store user connection info
    this.connectedUsers.set(userId, {
      socketId: socket.id,
      tenantId,
      role,
      connectedAt: new Date()
    });

    // Join tenant-specific room
    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
      
      if (!this.tenantRooms.has(tenantId)) {
        this.tenantRooms.set(tenantId, new Set());
      }
      this.tenantRooms.get(tenantId).add(socket.id);
      
      logger.info(`User ${userId} joined tenant room: ${tenantId}`);
    }

    // Join user-specific room
    socket.join(`user:${userId}`);

    // Handle custom events
    this.setupCustomEvents(socket);

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(socket, reason);
    });

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to Website Builder Backend',
      userId,
      tenantId,
      timestamp: new Date().toISOString()
    });
  }

  setupCustomEvents(socket) {
    const { userId, tenantId, role } = socket;

    // Subscribe to build updates
    socket.on('subscribe:builds', (data) => {
      if (tenantId) {
        socket.join(`builds:${tenantId}`);
        logger.info(`User ${userId} subscribed to build updates for tenant ${tenantId}`);
      }
    });

    // Subscribe to deployment updates
    socket.on('subscribe:deployments', (data) => {
      if (tenantId) {
        socket.join(`deployments:${tenantId}`);
        logger.info(`User ${userId} subscribed to deployment updates for tenant ${tenantId}`);
      }
    });

    // Subscribe to system notifications
    socket.on('subscribe:notifications', (data) => {
      socket.join(`notifications:${userId}`);
      logger.info(`User ${userId} subscribed to notifications`);
    });

    // Handle ping for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // Handle real-time chat/collaboration (future feature)
    socket.on('join:project', (data) => {
      const { projectId } = data;
      if (projectId && this.hasProjectAccess(userId, tenantId, projectId)) {
        socket.join(`project:${projectId}`);
        logger.info(`User ${userId} joined project collaboration room: ${projectId}`);
        
        socket.to(`project:${projectId}`).emit('user:joined', {
          userId,
          username: data.username || 'Unknown User',
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('leave:project', (data) => {
      const { projectId } = data;
      if (projectId) {
        socket.leave(`project:${projectId}`);
        socket.to(`project:${projectId}`).emit('user:left', {
          userId,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  handleDisconnection(socket, reason) {
    const { userId, tenantId } = socket;
    
    logger.info(`User ${userId} disconnected: ${reason}`);

    // Clean up user connection info
    this.connectedUsers.delete(userId);

    // Clean up tenant room info
    if (tenantId && this.tenantRooms.has(tenantId)) {
      this.tenantRooms.get(tenantId).delete(socket.id);
      
      if (this.tenantRooms.get(tenantId).size === 0) {
        this.tenantRooms.delete(tenantId);
      }
    }
  }

  // Public methods for sending real-time updates

  // Send build status update
  sendBuildUpdate(tenantId, buildData) {
    if (this.io) {
      this.io.to(`builds:${tenantId}`).emit('build:update', {
        type: 'build_status_changed',
        data: buildData,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Sent build update to tenant ${tenantId}:`, buildData.id);
    }
  }

  // Send deployment status update
  sendDeploymentUpdate(tenantId, deploymentData) {
    if (this.io) {
      this.io.to(`deployments:${tenantId}`).emit('deployment:update', {
        type: 'deployment_status_changed',
        data: deploymentData,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Sent deployment update to tenant ${tenantId}:`, deploymentData.id);
    }
  }

  // Send notification to specific user
  sendNotification(userId, notification) {
    if (this.io) {
      this.io.to(`notifications:${userId}`).emit('notification', {
        ...notification,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Sent notification to user ${userId}:`, notification.type);
    }
  }

  // Send system-wide announcement
  sendSystemAnnouncement(message, level = 'info') {
    if (this.io) {
      this.io.emit('system:announcement', {
        message,
        level,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Sent system announcement: ${message}`);
    }
  }

  // Send tenant-wide message
  sendTenantMessage(tenantId, message, type = 'info') {
    if (this.io) {
      this.io.to(`tenant:${tenantId}`).emit('tenant:message', {
        message,
        type,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Sent tenant message to ${tenantId}: ${message}`);
    }
  }

  // Get connection stats
  getConnectionStats() {
    return {
      totalConnections: this.connectedUsers.size,
      connectedTenants: this.tenantRooms.size,
      usersByTenant: Object.fromEntries(
        Array.from(this.tenantRooms.entries()).map(([tenantId, socketIds]) => [
          tenantId,
          socketIds.size
        ])
      )
    };
  }

  // Check if user has access to project (placeholder - implement based on your auth logic)
  hasProjectAccess(userId, tenantId, projectId) {
    // TODO: Implement proper project access validation
    // For now, assume users in same tenant have access
    return true;
  }

  // Gracefully close all connections
  close() {
    if (this.io) {
      this.io.close();
      logger.info('WebSocket service closed');
    }
  }
}

module.exports = new WebSocketService();
