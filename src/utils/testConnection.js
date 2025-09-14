const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

async function testDatabaseConnection() {
  const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
    errorFormat: 'pretty'
  });

  try {
    logger.info('Testing database connection...');
    console.log('DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^:]*@/, ':****@')); // Hide password
    
    // Test basic connection
    await prisma.$connect();
    logger.info('✅ Database connected successfully');

    // Test a simple query
    const result = await prisma.$queryRaw`SELECT version() as version, current_database() as database, current_user as user`;
    logger.info('✅ Database query successful:', result);

    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', {
      error: error.message,
      code: error.code,
      meta: error.meta
    });
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Run test if called directly
if (require.main === module) {
  require('dotenv').config();
  testDatabaseConnection()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

module.exports = testDatabaseConnection;