require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function getLatestBuildURL() {
  const prisma = new PrismaClient();
  
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { tenantId: 'himanshus-organization-bj3y65eh' },
      select: { cloudfrontDomain: true }
    });
    
    if (tenant && tenant.cloudfrontDomain) {
      const buildId = 'a8d87f4b-98a8-4495-97eb-bffd445d93d1';
      const url = `https://${tenant.cloudfrontDomain}/deployments/${buildId}/index.html`;
      
      console.log('🎉 Latest Build URL:');
      console.log(url);
    }
    
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

getLatestBuildURL();