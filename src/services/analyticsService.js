/**
 * Advanced Analytics and Monitoring Service
 * Tracks system performance, user behavior, and business metrics
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class AnalyticsService extends EventEmitter {
  constructor() {
    super();
    this.metrics = new Map();
    this.timers = new Map();
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.events = [];
    
    // Performance tracking
    this.performanceMetrics = {
      requests: {
        total: 0,
        byMethod: {},
        byRoute: {},
        byStatusCode: {},
        byApiVersion: {}
      },
      builds: {
        total: 0,
        successful: 0,
        failed: 0,
        totalBuildTime: 0,
        averageBuildTime: 0,
        byTenant: {}
      },
      deployments: {
        total: 0,
        successful: 0,
        failed: 0,
        totalDeployTime: 0,
        averageDeployTime: 0,
        byTenant: {}
      },
      websocket: {
        connections: 0,
        totalConnections: 0,
        messagesPerSecond: 0,
        averageConnectionDuration: 0
      },
      system: {
        uptime: 0,
        memoryUsage: {},
        cpuUsage: 0,
        diskUsage: 0
      }
    };
    
    // Start background collection
    this.startPerformanceMonitoring();
  }

  // Request tracking
  trackRequest(req, res, responseTime) {
    const method = req.method;
    const route = req.route?.path || req.path;
    const statusCode = res.statusCode;
    const apiVersion = req.apiVersion || 'v1';
    const userAgent = req.headers['user-agent'];
    const ip = req.ip;
    
    // Update counters
    this.performanceMetrics.requests.total++;
    this.performanceMetrics.requests.byMethod[method] = (this.performanceMetrics.requests.byMethod[method] || 0) + 1;
    this.performanceMetrics.requests.byRoute[route] = (this.performanceMetrics.requests.byRoute[route] || 0) + 1;
    this.performanceMetrics.requests.byStatusCode[statusCode] = (this.performanceMetrics.requests.byStatusCode[statusCode] || 0) + 1;
    this.performanceMetrics.requests.byApiVersion[apiVersion] = (this.performanceMetrics.requests.byApiVersion[apiVersion] || 0) + 1;

    // Track response times
    this.recordHistogram('request_duration_ms', responseTime);
    this.recordHistogram(`request_duration_${method.toLowerCase()}`, responseTime);

    // Track detailed request event
    const event = {
      type: 'request',
      timestamp: new Date().toISOString(),
      data: {
        method,
        route,
        statusCode,
        responseTime,
        apiVersion,
        userAgent: userAgent?.substring(0, 100), // Truncate long user agents
        ip: this.hashIP(ip), // Hash IP for privacy
        userId: req.user?.userId,
        tenantId: req.user?.tenantId
      }
    };

    this.addEvent(event);
    this.emit('request', event.data);
  }

  // Build tracking
  trackBuild(buildData, event = 'started') {
    const { id, tenant_id, status, build_time } = buildData;
    
    if (event === 'started') {
      this.performanceMetrics.builds.total++;
      this.performanceMetrics.builds.byTenant[tenant_id] = (this.performanceMetrics.builds.byTenant[tenant_id] || 0) + 1;
    } else if (event === 'completed') {
      this.performanceMetrics.builds.successful++;
      
      if (build_time) {
        this.performanceMetrics.builds.totalBuildTime += build_time;
        this.performanceMetrics.builds.averageBuildTime = 
          this.performanceMetrics.builds.totalBuildTime / this.performanceMetrics.builds.successful;
        this.recordHistogram('build_duration_ms', build_time);
      }
    } else if (event === 'failed') {
      this.performanceMetrics.builds.failed++;
    }

    const analyticsEvent = {
      type: 'build',
      timestamp: new Date().toISOString(),
      data: {
        buildId: id,
        tenantId: tenant_id,
        status,
        event,
        buildTime: build_time
      }
    };

    this.addEvent(analyticsEvent);
    this.emit('build', analyticsEvent.data);
  }

  // Deployment tracking
  trackDeployment(deploymentData, event = 'started') {
    const { id, tenant_id, status, deploy_time } = deploymentData;
    
    if (event === 'started') {
      this.performanceMetrics.deployments.total++;
      this.performanceMetrics.deployments.byTenant[tenant_id] = 
        (this.performanceMetrics.deployments.byTenant[tenant_id] || 0) + 1;
    } else if (event === 'completed') {
      this.performanceMetrics.deployments.successful++;
      
      if (deploy_time) {
        this.performanceMetrics.deployments.totalDeployTime += deploy_time;
        this.performanceMetrics.deployments.averageDeployTime = 
          this.performanceMetrics.deployments.totalDeployTime / this.performanceMetrics.deployments.successful;
        this.recordHistogram('deployment_duration_ms', deploy_time);
      }
    } else if (event === 'failed') {
      this.performanceMetrics.deployments.failed++;
    }

    const analyticsEvent = {
      type: 'deployment',
      timestamp: new Date().toISOString(),
      data: {
        deploymentId: id,
        tenantId: tenant_id,
        status,
        event,
        deployTime: deploy_time
      }
    };

    this.addEvent(analyticsEvent);
    this.emit('deployment', analyticsEvent.data);
  }

  // WebSocket tracking
  trackWebSocket(event, data = {}) {
    if (event === 'connection') {
      this.performanceMetrics.websocket.connections++;
      this.performanceMetrics.websocket.totalConnections++;
    } else if (event === 'disconnection') {
      this.performanceMetrics.websocket.connections--;
      
      if (data.duration) {
        this.recordHistogram('websocket_connection_duration_ms', data.duration);
      }
    }

    const analyticsEvent = {
      type: 'websocket',
      timestamp: new Date().toISOString(),
      data: {
        event,
        ...data
      }
    };

    this.addEvent(analyticsEvent);
    this.emit('websocket', analyticsEvent.data);
  }

  // Custom event tracking
  trackCustomEvent(eventType, eventData) {
    const event = {
      type: eventType,
      timestamp: new Date().toISOString(),
      data: eventData
    };

    this.addEvent(event);
    this.emit('custom', event);
  }

  // Metric recording methods
  recordCounter(name, value = 1, tags = {}) {
    const key = this.getMetricKey(name, tags);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  recordGauge(name, value, tags = {}) {
    const key = this.getMetricKey(name, tags);
    this.gauges.set(key, value);
  }

  recordHistogram(name, value, tags = {}) {
    const key = this.getMetricKey(name, tags);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        values: []
      });
    }

    const histogram = this.histograms.get(key);
    histogram.count++;
    histogram.sum += value;
    histogram.min = Math.min(histogram.min, value);
    histogram.max = Math.max(histogram.max, value);
    
    // Keep last 1000 values for percentile calculations
    histogram.values.push(value);
    if (histogram.values.length > 1000) {
      histogram.values.shift();
    }
  }

  // Timer methods
  startTimer(name, tags = {}) {
    const key = this.getMetricKey(name, tags);
    this.timers.set(key, Date.now());
    return key;
  }

  endTimer(timerKey) {
    const startTime = this.timers.get(timerKey);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.timers.delete(timerKey);
      return duration;
    }
    return null;
  }

  // System performance monitoring
  startPerformanceMonitoring() {
    // Update system metrics every 30 seconds
    setInterval(() => {
      this.updateSystemMetrics();
    }, 30000);

    // Calculate rates every minute
    setInterval(() => {
      this.calculateRates();
    }, 60000);

    // Cleanup old events every hour
    setInterval(() => {
      this.cleanupEvents();
    }, 3600000);
  }

  updateSystemMetrics() {
    this.performanceMetrics.system.uptime = process.uptime();
    this.performanceMetrics.system.memoryUsage = process.memoryUsage();
    
    // Record as metrics
    this.recordGauge('system_uptime_seconds', this.performanceMetrics.system.uptime);
    this.recordGauge('system_memory_rss_bytes', this.performanceMetrics.system.memoryUsage.rss);
    this.recordGauge('system_memory_heap_used_bytes', this.performanceMetrics.system.memoryUsage.heapUsed);
    this.recordGauge('system_memory_heap_total_bytes', this.performanceMetrics.system.memoryUsage.heapTotal);
    this.recordGauge('system_memory_external_bytes', this.performanceMetrics.system.memoryUsage.external);
  }

  calculateRates() {
    // This is a simple implementation - in production, you'd want more sophisticated rate calculation
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Calculate requests per minute
    const recentRequests = this.events.filter(
      event => event.type === 'request' && new Date(event.timestamp).getTime() > oneMinuteAgo
    );
    
    this.recordGauge('requests_per_minute', recentRequests.length);
  }

  cleanupEvents() {
    // Keep only events from the last 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.events = this.events.filter(
      event => new Date(event.timestamp).getTime() > oneDayAgo
    );
    
    logger.debug(`Analytics cleanup: keeping ${this.events.length} events`);
  }

  // Utility methods
  getMetricKey(name, tags) {
    if (Object.keys(tags).length === 0) return name;
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    return `${name}{${tagString}}`;
  }

  addEvent(event) {
    this.events.push(event);
    
    // Log significant events
    if (['build', 'deployment', 'error'].includes(event.type)) {
      logger.info('Analytics event:', event);
    }
  }

  hashIP(ip) {
    // Simple hash for privacy (in production, use a proper hashing library)
    return require('crypto').createHash('sha256').update(ip + 'salt').digest('hex').substring(0, 8);
  }

  // Data export methods
  getMetrics() {
    return {
      performance: this.performanceMetrics,
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([key, hist]) => [
          key,
          {
            count: hist.count,
            sum: hist.sum,
            min: hist.min,
            max: hist.max,
            avg: hist.count > 0 ? hist.sum / hist.count : 0,
            p95: this.calculatePercentile(hist.values, 95),
            p99: this.calculatePercentile(hist.values, 99)
          }
        ])
      )
    };
  }

  getEvents(options = {}) {
    let filteredEvents = this.events;
    
    if (options.type) {
      filteredEvents = filteredEvents.filter(event => event.type === options.type);
    }
    
    if (options.since) {
      const sinceDate = new Date(options.since).getTime();
      filteredEvents = filteredEvents.filter(event => 
        new Date(event.timestamp).getTime() > sinceDate
      );
    }
    
    if (options.limit) {
      filteredEvents = filteredEvents.slice(-options.limit);
    }
    
    return filteredEvents;
  }

  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // Health check
  getHealthStatus() {
    const metrics = this.getMetrics();
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    
    const recentErrors = this.events.filter(
      event => event.type === 'error' && new Date(event.timestamp).getTime() > fiveMinutesAgo
    );
    
    const recentRequests = this.events.filter(
      event => event.type === 'request' && new Date(event.timestamp).getTime() > fiveMinutesAgo
    );

    return {
      status: recentErrors.length > 10 ? 'unhealthy' : 'healthy',
      metrics: {
        events_total: this.events.length,
        recent_errors: recentErrors.length,
        recent_requests: recentRequests.length,
        memory_usage_mb: Math.round(metrics.performance.system.memoryUsage.heapUsed / 1024 / 1024),
        uptime_hours: Math.round(metrics.performance.system.uptime / 3600)
      },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new AnalyticsService();
