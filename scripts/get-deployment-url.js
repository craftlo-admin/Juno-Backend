require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function getDeploymentDetails() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Fetching CloudFront deployment details...\n');
    
    const tenant = await prisma.tenant.findUnique({
      where: { tenantId: 'himanshus-organization-bj3y65eh' },
      select: {
        cloudfrontDistributionId: true,
        cloudfrontDomain: true,
        cloudfrontStatus: true,
        cloudfrontUniqueId: true,
        cloudfrontCreatedAt: true
      }
    });
    
    if (tenant && tenant.cloudfrontDistributionId) {
      console.log('🎉 SUCCESS! CloudFront Distribution Created:');
      console.log('='.repeat(50));
      console.log(`📊 Distribution ID: ${tenant.cloudfrontDistributionId}`);
      console.log(`🌐 CloudFront Domain: ${tenant.cloudfrontDomain}`);
      console.log(`📈 Status: ${tenant.cloudfrontStatus}`);
      console.log(`🔑 Unique ID: ${tenant.cloudfrontUniqueId}`);
      console.log(`📅 Created: ${tenant.cloudfrontCreatedAt}`);
      
      console.log('\n🚀 Your Website URLs:');
      console.log('='.repeat(30));
      console.log(`🏠 Main Domain: https://${tenant.cloudfrontDomain}`);
      console.log(`📦 Latest Build: https://${tenant.cloudfrontDomain}/deployments/524b2a9e-4a46-4548-beb2-b6355024e636/`);
      console.log(`📄 Index Page: https://${tenant.cloudfrontDomain}/deployments/524b2a9e-4a46-4548-beb2-b6355024e636/index.html`);
      
      console.log('\n💡 Notes:');
      console.log('• This is your tenant-specific CloudFront distribution');
      console.log('• SSL certificate is automatically provided by AWS');
      console.log('• Domain is unique to your tenant');
      console.log('• Future builds will use the same distribution');
      
    } else {
      console.log('❌ No CloudFront distribution found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

getDeploymentDetails();