/**
 * Analytics Middleware
 * Automatically tracks requests and integrates with analytics service
 */

const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');

function analyticsMiddleware(req, res, next) {
  const startTime = Date.now();
  
  // Add unique request ID if not present
  if (!req.id && !req.headers['x-request-id']) {
    req.id = generateRequestId();
  }

  // Track the start of the request
  const timerKey = analyticsService.startTimer('request_duration', {
    method: req.method,
    route: req.route?.path || req.path
  });

  // Store analytics data in request
  req.analytics = {
    startTime,
    timerKey
  };

  // Override res.end to capture response data
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const responseTime = Date.now() - startTime;
    
    // Track the request
    analyticsService.trackRequest(req, res, responseTime);
    
    // End the timer
    if (timerKey) {
      analyticsService.endTimer(timerKey);
    }

    // Track slow requests (> 2 seconds)
    if (responseTime > 2000) {
      logger.warn(`Slow request detected: ${req.method} ${req.path} took ${responseTime}ms`, {
        method: req.method,
        path: req.path,
        responseTime,
        statusCode: res.statusCode,
        userAgent: req.headers['user-agent'],
        ip: req.ip
      });
      
      analyticsService.trackCustomEvent('slow_request', {
        method: req.method,
        path: req.path,
        responseTime,
        statusCode: res.statusCode,
        threshold: 2000
      });
    }

    // Track 4xx and 5xx errors
    if (res.statusCode >= 400) {
      const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
      
      analyticsService.trackCustomEvent('http_error', {
        type: errorType,
        statusCode: res.statusCode,
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        userId: req.user?.userId,
        tenantId: req.user?.tenantId
      });
    }

    // Call the original end function
    originalEnd.call(this, chunk, encoding);
  };

  next();
}

function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Enhanced error tracking middleware
function errorTrackingMiddleware(err, req, res, next) {
  const responseTime = req.analytics ? Date.now() - req.analytics.startTime : 0;
  
  // Track the error event
  analyticsService.trackCustomEvent('error', {
    name: err.name,
    message: err.message,
    stack: err.stack?.substring(0, 500), // Truncate stack trace
    statusCode: err.statusCode || 500,
    method: req.method,
    path: req.path,
    responseTime,
    userId: req.user?.userId,
    tenantId: req.user?.tenantId,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });

  // Record error metrics
  analyticsService.recordCounter('errors_total', 1, {
    type: err.name,
    statusCode: err.statusCode || 500
  });

  next(err);
}

// API usage analytics middleware
function apiUsageMiddleware(req, res, next) {
  const apiVersion = req.apiVersion || 'v1';
  const endpoint = req.route?.path || req.path;
  
  // Track API version usage
  analyticsService.recordCounter('api_requests_total', 1, {
    version: apiVersion,
    method: req.method,
    endpoint: endpoint
  });

  // Track deprecated API usage
  if (apiVersion === 'v1') {
    analyticsService.recordCounter('deprecated_api_usage', 1, {
      endpoint: endpoint,
      method: req.method
    });
  }

  // Track authentication method
  if (req.user) {
    analyticsService.recordCounter('authenticated_requests', 1, {
      authMethod: req.authMethod || 'jwt'
    });
  } else {
    analyticsService.recordCounter('unauthenticated_requests', 1);
  }

  next();
}

// Business metrics middleware
function businessMetricsMiddleware(req, res, next) {
  // Track tenant activity
  if (req.user?.tenantId) {
    analyticsService.recordCounter('tenant_activity', 1, {
      tenantId: req.user.tenantId,
      action: req.method,
      endpoint: req.route?.path || req.path
    });
  }

  // Track feature usage
  const features = extractFeatureUsage(req);
  features.forEach(feature => {
    analyticsService.recordCounter('feature_usage', 1, {
      feature: feature,
      userRole: req.user?.role || 'anonymous'
    });
  });

  next();
}

function extractFeatureUsage(req) {
  const features = [];
  const path = req.path;
  
  if (path.includes('/uploads')) features.push('file_upload');
  if (path.includes('/builds')) features.push('build_management');
  if (path.includes('/deployments')) features.push('deployment_management');
  if (path.includes('/domains')) features.push('domain_management');
  if (path.includes('/metrics')) features.push('analytics_access');
  if (path.includes('/realtime')) features.push('realtime_features');
  
  return features;
}

// Resource usage tracking middleware
function resourceTrackingMiddleware(req, res, next) {
  const startMemory = process.memoryUsage();
  
  res.on('finish', () => {
    const endMemory = process.memoryUsage();
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
    
    // Track memory usage per request
    if (Math.abs(memoryDelta) > 1024 * 1024) { // Only track if > 1MB change
      analyticsService.recordHistogram('request_memory_delta_bytes', memoryDelta, {
        method: req.method,
        endpoint: req.route?.path || req.path
      });
    }
  });
  
  next();
}

module.exports = {
  analyticsMiddleware,
  errorTrackingMiddleware,
  apiUsageMiddleware,
  businessMetricsMiddleware,
  resourceTrackingMiddleware
};
