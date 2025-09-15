const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

/**
 * Multi-tenant Website Builder - Enhanced Prisma Client
 * Following project architecture: Express.js MVC, comprehensive error handling, production-ready
 * Implements robust connection management with automatic retry and reconnection
 */

// Global Prisma instance with enhanced configuration
let prisma = null;

/**
 * Creates and configures Prisma client with robust connection handling
 */
function createPrismaClient() {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Enhanced connection configuration
  const prismaConfig = {
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    },
    log: isDevelopment ? 
      [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' }
      ] : 
      [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' }
      ],
    errorFormat: 'pretty'
  };

  const client = new PrismaClient(prismaConfig);

  // Enhanced logging with connection monitoring
  if (isDevelopment) {
    client.$on('query', (e) => {
      logger.debug('🔍 Prisma Query', {
        query: e.query,
        params: e.params,
        duration: `${e.duration}ms`,
        target: e.target
      });
    });
  }

  // Error event handling
  client.$on('error', (e) => {
    logger.error('❌ Prisma Database Error Event', {
      message: e.message,
      target: e.target,
      timestamp: e.timestamp,
      service: 'website-deployment-backend'
    });

    // Handle specific connection errors
    if (e.message.includes('connection was forcibly closed') || 
        e.message.includes('ConnectionReset') ||
        e.message.includes('ECONNRESET')) {
      logger.warn('🔄 Database connection reset detected, will attempt reconnection on next query');
      
      // Trigger connection refresh (Prisma will handle reconnection automatically)
      setTimeout(async () => {
        try {
          await client.$disconnect();
          logger.info('🔌 Prisma client disconnected, ready for reconnection');
        } catch (disconnectError) {
          logger.error('❌ Error during Prisma disconnect:', disconnectError);
        }
      }, 1000);
    }
  });

  client.$on('info', (e) => {
    logger.info('ℹ️ Prisma Info', {
      message: e.message,
      target: e.target,
      timestamp: e.timestamp
    });
  });

  client.$on('warn', (e) => {
    logger.warn('⚠️ Prisma Warning', {
      message: e.message,
      target: e.target,
      timestamp: e.timestamp
    });
  });

  return client;
}

/**
 * Get Prisma client instance (lazy initialization)
 */
function getPrismaClient() {
  if (!prisma) {
    throw new Error('Prisma client not initialized. Please check database configuration.');
  }
  return prisma;
}

/**
 * Database connection health check with retry logic
 */
async function checkDatabaseConnection(retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`🔍 Database connection check (attempt ${attempt}/${retries})`);
      
      await getPrismaClient().$queryRaw`SELECT 1 as health_check`;
      
      logger.info('✅ Database connection healthy');
      return { healthy: true, attempt };
      
    } catch (error) {
      logger.error(`❌ Database connection check failed (attempt ${attempt}/${retries})`, {
        error: error.message,
        code: error.code,
        meta: error.meta
      });

      if (attempt === retries) {
        logger.error('💀 All database connection attempts exhausted');
        return { 
          healthy: false, 
          error: error.message, 
          lastAttempt: attempt 
        };
      }

      // Wait before retry with exponential backoff
      const waitTime = delay * Math.pow(2, attempt - 1);
      logger.info(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Execute database operation with automatic retry on connection errors
 */
async function executeWithRetry(operation, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isConnectionError = 
        error.message.includes('connection was forcibly closed') ||
        error.message.includes('ConnectionReset') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('Connection terminated') ||
        error.code === 'P1001' || // Connection timeout
        error.code === 'P1017';   // Server has closed the connection

      if (isConnectionError && attempt < maxRetries) {
        logger.warn(`🔄 Database connection error detected, retrying (${attempt}/${maxRetries})`, {
          error: error.message,
          code: error.code
        });

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Force disconnect and let Prisma reconnect
        try {
          if (prisma) {
            await prisma.$disconnect();
          }
        } catch (disconnectError) {
          // Ignore disconnect errors
        }
        
        continue;
      }

      // Re-throw if not a connection error or max retries reached
      throw error;
    }
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown() {
  logger.info('🛑 Initiating graceful database shutdown...');
  
  try {
    if (prisma) {
      await prisma.$disconnect();
      logger.info('✅ Database connections closed successfully');
    }
  } catch (error) {
    logger.error('❌ Error during database shutdown:', error);
  }
}

// Initialize Prisma client
try {
  prisma = createPrismaClient();
  logger.info('✅ Prisma client initialized successfully');
  
  // Perform initial connection test
  setTimeout(async () => {
    await checkDatabaseConnection();
  }, 1000);
  
} catch (error) {
  logger.error('❌ Failed to initialize Prisma client:', error);
  throw new Error(`Database initialization failed: ${error.message}`);
}

// Process shutdown handlers
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('beforeExit', gracefulShutdown);

module.exports = {
  get prisma() {
    return getPrismaClient();
  },
  checkDatabaseConnection,
  executeWithRetry,
  gracefulShutdown
};
