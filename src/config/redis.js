const logger = require('../utils/logger');

let redisClient = null;

// Try to configure Redis
try {
  const redis = require('redis');
  
  // Create Redis client with proper configuration
  redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      connectTimeout: 5000,
      commandTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Redis: Too many reconnection attempts, giving up');
          return false;
        }
        return Math.min(retries * 100, 3000);
      }
    },
    lazyConnect: true // Don't connect immediately
  });

  // Event handlers
  redisClient.on('error', (err) => {
    logger.warn('Redis client error:', err.message);
  });

  redisClient.on('connect', () => {
    logger.info('✅ Redis client connected');
  });

  redisClient.on('ready', () => {
    logger.info('✅ Redis client ready');
  });

  redisClient.on('end', () => {
    logger.info('Redis client disconnected');
  });

  redisClient.on('reconnecting', () => {
    logger.info('Redis client reconnecting...');
  });

  // Try to connect
  redisClient.connect().catch((error) => {
    logger.warn('Redis connection failed, using memory cache fallback:', error.message);
    redisClient = null;
  });

} catch (error) {
  logger.warn('Redis not available, using in-memory cache fallback:', error.message);
  redisClient = null;
}

// Fallback in-memory cache implementation
class MemoryCache {
  constructor() {
    this.cache = new Map();
    this.timeouts = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
    logger.info('📦 Using in-memory cache fallback for Redis');
  }

  async get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.stats.hits++;
      return value;
    }
    this.stats.misses++;
    return null;
  }

  async set(key, value, options = {}) {
    this.cache.set(key, value);
    this.stats.sets++;
    
    // Handle expiration
    if (options.EX) {
      // Clear existing timeout
      if (this.timeouts.has(key)) {
        clearTimeout(this.timeouts.get(key));
      }
      
      // Set new timeout
      const timeout = setTimeout(() => {
        this.cache.delete(key);
        this.timeouts.delete(key);
      }, options.EX * 1000);
      
      this.timeouts.set(key, timeout);
    }
    
    return 'OK';
  }

  async del(keys) {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    let deletedCount = 0;
    
    keysArray.forEach(key => {
      if (this.cache.has(key)) {
        this.cache.delete(key);
        deletedCount++;
        this.stats.deletes++;
      }
      
      if (this.timeouts.has(key)) {
        clearTimeout(this.timeouts.get(key));
        this.timeouts.delete(key);
      }
    });
    
    return deletedCount;
  }

  async disconnect() {
    this.cache.clear();
    this.timeouts.forEach(timeout => clearTimeout(timeout));
    this.timeouts.clear();
    logger.info('Memory cache cleared');
  }

  async ping() {
    return 'PONG';
  }

  getStats() {
    return {
      ...this.stats,
      totalKeys: this.cache.size,
      totalTimeouts: this.timeouts.size
    };
  }
}

// Export Redis client or fallback
const cacheClient = redisClient || new MemoryCache();

// Graceful shutdown
process.on('SIGINT', async () => {
  if (cacheClient && typeof cacheClient.disconnect === 'function') {
    try {
      await cacheClient.disconnect();
      logger.info('Cache client disconnected gracefully');
    } catch (error) {
      logger.error('Error disconnecting cache client:', error);
    }
  }
});

module.exports = cacheClient;
