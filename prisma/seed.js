const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create admin user
  const adminPasswordHash = await bcrypt.hash('admin123!', 12);
  
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: adminPasswordHash,
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      emailVerified: true,
    },
  });

  console.log('✅ Created admin user:', adminUser.email);

  // Create test user
  const testPasswordHash = await bcrypt.hash('test123!', 12);
  
  const testUser = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      passwordHash: testPasswordHash,
      firstName: 'Test',
      lastName: 'User',
      role: 'user',
      emailVerified: true,
    },
  });

  console.log('✅ Created test user:', testUser.email);

  // Create sample tenant for test user
  const sampleTenant = await prisma.tenant.upsert({
    where: { tenantId: 'demo-site' },
    update: {},
    create: {
      tenantId: 'demo-site',
      ownerId: testUser.id,
      name: 'Demo Website',
      description: 'A sample demo website for testing',
      status: 'active',
      domain: `demo-site.${process.env.BASE_DOMAIN || 'localhost'}`,
      config: {
        theme: 'default',
        features: ['analytics', 'customDomains'],
        analytics: true,
      },
      buildSettings: {
        nodeVersion: '18',
        buildCommand: 'npm run build',
        outputDirectory: 'out',
      },
    },
  });

  console.log('✅ Created sample tenant:', sampleTenant.tenantId);

  console.log('🎉 Database seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Database seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
