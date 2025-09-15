const logger = require('../utils/logger');

let redisClient = null;
let isConnecting = false;
let hasGivenUp = false; // Track if we've given up on Redis

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
        if (retries > 3) { // Reduced from 5 to 3
          logger.info('📦 Redis unavailable, switching to memory cache permanently');
          hasGivenUp = true;
          redisClient = null;
          return false; // Stop reconnecting
        }
        return Math.min(retries * 1000, 3000);
      }
    },
    lazyConnect: true // Don't connect immediately
  });

  // Event handlers
  redisClient.on('error', (err) => {
    // Only log errors if we haven't given up on Redis yet
    if (!hasGivenUp) {
      logger.debug('Redis connection issue:', err.message); // Changed to debug level
    }
  });

  redisClient.on('connect', () => {
    logger.info('✅ Redis client connected');
    isConnecting = false;
    hasGivenUp = false; // Reset if we successfully connect
  });

  redisClient.on('ready', () => {
    logger.info('✅ Redis client ready');
  });

  redisClient.on('end', () => {
    if (!hasGivenUp) {
      logger.debug('Redis client disconnected'); // Changed to debug level
    }
  });

  redisClient.on('reconnecting', () => {
    if (!hasGivenUp) {
      logger.debug('Redis client reconnecting...'); // Changed to debug level
      isConnecting = true;
    }
  });

  // Try to connect with timeout
  const connectWithTimeout = async () => {
    if (hasGivenUp) return; // Don't even try if we've given up
    
    try {
      isConnecting = true;
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000) // Reduced timeout
        )
      ]);
    } catch (error) {
      if (!hasGivenUp) {
        logger.info('📦 Redis unavailable, using memory cache fallback');
        hasGivenUp = true;
      }
      redisClient = null;
      isConnecting = false;
    }
  };

  // Don't block startup - connect in background
  connectWithTimeout();

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

// Dynamic cache client that can switch between Redis and Memory cache
class CacheClientWrapper {
  constructor() {
    this.memoryCache = new MemoryCache();
  }

  get activeClient() {
    return (redisClient && !hasGivenUp) ? redisClient : this.memoryCache;
  }

  async get(key) {
    try {
      if (hasGivenUp || !redisClient) {
        return await this.memoryCache.get(key);
      }
      return await this.activeClient.get(key);
    } catch (error) {
      // Silent fallback to memory cache
      return await this.memoryCache.get(key);
    }
  }

  async set(key, value, options = {}) {
    try {
      if (hasGivenUp || !redisClient) {
        return await this.memoryCache.set(key, value, options);
      }
      return await this.activeClient.set(key, value, options);
    } catch (error) {
      // Silent fallback to memory cache
      return await this.memoryCache.set(key, value, options);
    }
  }

  async del(keys) {
    try {
      if (hasGivenUp || !redisClient) {
        return await this.memoryCache.del(keys);
      }
      return await this.activeClient.del(keys);
    } catch (error) {
      // Silent fallback to memory cache
      return await this.memoryCache.del(keys);
    }
  }

  async ping() {
    try {
      if (!hasGivenUp && redisClient) {
        return await redisClient.ping();
      } else {
        return await this.memoryCache.ping();
      }
    } catch (error) {
      return await this.memoryCache.ping();
    }
  }

  async disconnect() {
    try {
      if (redisClient && typeof redisClient.disconnect === 'function') {
        await redisClient.disconnect();
      }
    } catch (error) {
      logger.debug('Error disconnecting Redis:', error.message);
    }
    
    try {
      await this.memoryCache.disconnect();
    } catch (error) {
      logger.debug('Error disconnecting memory cache:', error.message);
    }
  }

  getStats() {
    if (this.activeClient === redisClient) {
      return { type: 'redis', connected: true };
    } else {
      return { type: 'memory', ...this.memoryCache.getStats() };
    }
  }
}

// Export dynamic cache client
const cacheClient = new CacheClientWrapper();

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await cacheClient.disconnect();
    logger.info('Cache client disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting cache client:', error);
  }
});

module.exports = cacheClient;
