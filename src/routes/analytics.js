const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analyticsService');
const { authenticateToken: auth } = require('../middleware/auth');
const { formatResponse, hasFeature } = require('../middleware/apiVersioning');
const logger = require('../utils/logger');

// Get comprehensive analytics dashboard (admin only)
router.get('/dashboard', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    const metrics = analyticsService.getMetrics();
    const healthStatus = analyticsService.getHealthStatus();
    
    // Get recent events for dashboard
    const recentEvents = analyticsService.getEvents({
      limit: 50,
      since: new Date(Date.now() - 60 * 60 * 1000).toISOString() // Last hour
    });

    const dashboardData = {
      health: healthStatus,
      metrics: metrics,
      recent_activity: recentEvents,
      summary: {
        total_requests: metrics.performance.requests.total,
        total_builds: metrics.performance.builds.total,
        total_deployments: metrics.performance.deployments.total,
        active_websocket_connections: metrics.performance.websocket.connections,
        uptime_hours: Math.round(metrics.performance.system.uptime / 3600),
        memory_usage_mb: Math.round(metrics.performance.system.memoryUsage.heapUsed / 1024 / 1024)
      }
    };

    res.json(formatResponse(dashboardData, req, {
      refresh_interval: 30,
      last_updated: new Date().toISOString()
    }));

  } catch (error) {
    logger.error('Error getting analytics dashboard:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve analytics dashboard'
    });
  }
});

// Get performance metrics
router.get('/performance', auth, async (req, res) => {
  try {
    const { timeRange = '1h', granularity = 'minute' } = req.query;
    
    // Check permissions
    if (req.user.role !== 'admin' && !hasFeature('advanced_metrics', req.apiVersion)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Advanced metrics access not available in this API version or for your role'
      });
    }

    const metrics = analyticsService.getMetrics();
    
    const performanceData = {
      requests: {
        total: metrics.performance.requests.total,
        by_method: metrics.performance.requests.byMethod,
        by_status_code: metrics.performance.requests.byStatusCode,
        by_api_version: metrics.performance.requests.byApiVersion,
        response_times: metrics.histograms['request_duration_ms'] || {}
      },
      builds: {
        total: metrics.performance.builds.total,
        success_rate: metrics.performance.builds.total > 0 
          ? (metrics.performance.builds.successful / metrics.performance.builds.total * 100).toFixed(2)
          : 0,
        average_duration: metrics.performance.builds.averageBuildTime,
        by_tenant: metrics.performance.builds.byTenant
      },
      deployments: {
        total: metrics.performance.deployments.total,
        success_rate: metrics.performance.deployments.total > 0
          ? (metrics.performance.deployments.successful / metrics.performance.deployments.total * 100).toFixed(2) 
          : 0,
        average_duration: metrics.performance.deployments.averageDeployTime,
        by_tenant: metrics.performance.deployments.byTenant
      },
      system: metrics.performance.system
    };

    res.json(formatResponse(performanceData, req, {
      time_range: timeRange,
      granularity: granularity
    }));

  } catch (error) {
    logger.error('Error getting performance metrics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve performance metrics'
    });
  }
});

// Get tenant-specific analytics
router.get('/tenant/:tenantId', auth, async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    // Check permissions
    if (req.user.role !== 'admin' && req.user.tenantId !== tenantId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied to this tenant analytics'
      });
    }

    const events = analyticsService.getEvents({
      since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Last 24 hours
    });

    // Filter events for this tenant
    const tenantEvents = events.filter(event => 
      event.data.tenantId === tenantId || 
      (event.type === 'request' && event.data.tenantId === tenantId)
    );

    const tenantMetrics = {
      activity_summary: {
        total_events: tenantEvents.length,
        builds: tenantEvents.filter(e => e.type === 'build').length,
        deployments: tenantEvents.filter(e => e.type === 'deployment').length,
        requests: tenantEvents.filter(e => e.type === 'request').length,
        errors: tenantEvents.filter(e => e.type === 'error').length
      },
      recent_activity: tenantEvents.slice(-20), // Last 20 events
      build_performance: {
        total_builds: tenantEvents.filter(e => e.type === 'build' && e.data.event === 'started').length,
        successful_builds: tenantEvents.filter(e => e.type === 'build' && e.data.event === 'completed').length,
        failed_builds: tenantEvents.filter(e => e.type === 'build' && e.data.event === 'failed').length
      },
      deployment_performance: {
        total_deployments: tenantEvents.filter(e => e.type === 'deployment' && e.data.event === 'started').length,
        successful_deployments: tenantEvents.filter(e => e.type === 'deployment' && e.data.event === 'completed').length,
        failed_deployments: tenantEvents.filter(e => e.type === 'deployment' && e.data.event === 'failed').length
      }
    };

    res.json(formatResponse(tenantMetrics, req));

  } catch (error) {
    logger.error('Error getting tenant analytics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve tenant analytics'
    });
  }
});

// Get system health status
router.get('/health', auth, async (req, res) => {
  try {
    const healthStatus = analyticsService.getHealthStatus();
    
    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(formatResponse(healthStatus, req));

  } catch (error) {
    logger.error('Error getting analytics health:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve health status'
    });
  }
});

// Get real-time metrics stream (admin only)
router.get('/stream', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    // Set up Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial data
    const initialMetrics = analyticsService.getMetrics();
    res.write(`data: ${JSON.stringify(initialMetrics)}\n\n`);

    // Set up real-time updates
    const intervalId = setInterval(() => {
      const metrics = analyticsService.getMetrics();
      res.write(`data: ${JSON.stringify(metrics)}\n\n`);
    }, 5000); // Update every 5 seconds

    // Listen for analytics events
    const eventHandler = (data) => {
      res.write(`event: analytics\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    analyticsService.on('request', eventHandler);
    analyticsService.on('build', eventHandler);
    analyticsService.on('deployment', eventHandler);

    // Cleanup on client disconnect
    req.on('close', () => {
      clearInterval(intervalId);
      analyticsService.removeListener('request', eventHandler);
      analyticsService.removeListener('build', eventHandler);
      analyticsService.removeListener('deployment', eventHandler);
    });

  } catch (error) {
    logger.error('Error setting up analytics stream:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to set up analytics stream'
    });
  }
});

// Export metrics in Prometheus format (for integration with monitoring tools)
router.get('/prometheus', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    const metrics = analyticsService.getMetrics();
    let prometheusOutput = '';

    // Convert counters
    Object.entries(metrics.counters).forEach(([name, value]) => {
      prometheusOutput += `# TYPE ${name} counter\n`;
      prometheusOutput += `${name} ${value}\n`;
    });

    // Convert gauges
    Object.entries(metrics.gauges).forEach(([name, value]) => {
      prometheusOutput += `# TYPE ${name} gauge\n`;
      prometheusOutput += `${name} ${value}\n`;
    });

    // Convert histograms
    Object.entries(metrics.histograms).forEach(([name, hist]) => {
      prometheusOutput += `# TYPE ${name} histogram\n`;
      prometheusOutput += `${name}_count ${hist.count}\n`;
      prometheusOutput += `${name}_sum ${hist.sum}\n`;
      prometheusOutput += `${name}_bucket{le="50"} ${hist.count}\n`;
      prometheusOutput += `${name}_bucket{le="95"} ${hist.count}\n`;
      prometheusOutput += `${name}_bucket{le="99"} ${hist.count}\n`;
      prometheusOutput += `${name}_bucket{le="+Inf"} ${hist.count}\n`;
    });

    res.setHeader('Content-Type', 'text/plain');
    res.send(prometheusOutput);

  } catch (error) {
    logger.error('Error generating Prometheus metrics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate Prometheus metrics'
    });
  }
});

// Custom event tracking endpoint
router.post('/events', auth, async (req, res) => {
  try {
    const { event_type, event_data } = req.body;

    if (!event_type) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'event_type is required'
      });
    }

    // Add user context to event data
    const enrichedEventData = {
      ...event_data,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      userRole: req.user.role,
      source: 'api'
    };

    analyticsService.trackCustomEvent(event_type, enrichedEventData);

    res.json(formatResponse({
      message: 'Event tracked successfully',
      event_type: event_type
    }, req));

  } catch (error) {
    logger.error('Error tracking custom event:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to track custom event'
    });
  }
});

module.exports = router;
