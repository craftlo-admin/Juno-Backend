require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function quickTest() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🧪 Testing fixed TenantDistributionService...');
    
    // Test the database query fix
    const tenant = await prisma.tenant.findUnique({
      where: { tenantId: 'himanshus-organization-bj3y65eh' },
      select: {
        id: true,
        tenantId: true,
        name: true,
        cloudfrontDistributionId: true,
        cloudfrontDomain: true,
        cloudfrontStatus: true
      }
    });
    
    if (tenant) {
      console.log('✅ Database query successful!');
      console.log(`   Tenant ID: ${tenant.tenantId}`);
      console.log(`   Name: ${tenant.name}`);
      console.log(`   CloudFront Distribution: ${tenant.cloudfrontDistributionId || 'None'}`);
      console.log(`   CloudFront Domain: ${tenant.cloudfrontDomain || 'None'}`);
      
      // Now test the service method
      const TenantDistributionService = require('../src/services/tenantDistributionService');
      const result = await TenantDistributionService.getTenantDistribution('himanshus-organization-bj3y65eh');
      
      if (result) {
        console.log('✅ TenantDistributionService.getTenantDistribution() works!');
        console.log('   Result:', result);
      } else {
        console.log('✅ TenantDistributionService.getTenantDistribution() works - no existing distribution');
      }
      
    } else {
      console.log('❌ Tenant not found');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await prisma.$disconnect();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
}

quickTest();