#!/usr/bin/env node

require('dotenv').config();
const AWS = require('aws-sdk');
const logger = require('../src/utils/logger');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const cloudFront = new AWS.CloudFront();

/**
 * Update existing shared CloudFront distribution to add SSL certificate and custom domains
 */

async function main() {
  console.log('🔧 Updating Shared CloudFront Distribution with SSL Support');
  console.log('='.repeat(60));

  const distributionId = process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID;
  const sslCertificateArn = process.env.WILDCARD_SSL_CERTIFICATE_ARN;
  const customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';

  if (!distributionId) {
    console.error('❌ SHARED_CLOUDFRONT_DISTRIBUTION_ID not found in environment');
    console.error('   Please run: npm run cloudfront:setup first');
    process.exit(1);
  }

  if (!sslCertificateArn) {
    console.error('❌ WILDCARD_SSL_CERTIFICATE_ARN not found in environment');
    console.error('   Please create a wildcard SSL certificate in ACM (us-east-1) for *.junotech.in');
    process.exit(1);
  }

  console.log('📋 Configuration:');
  console.log(`   Distribution ID: ${distributionId}`);
  console.log(`   SSL Certificate: ${sslCertificateArn}`);
  console.log(`   Custom Domain: *.${customDomainBase}`);

  try {
    // Get current distribution configuration
    console.log('\n🔍 Getting current distribution configuration...');
    const currentResult = await cloudFront.getDistributionConfig({ Id: distributionId }).promise();
    const config = currentResult.DistributionConfig;
    const etag = currentResult.ETag;

    console.log(`   Current status: ${config.Enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   Current aliases: ${config.Aliases.Items.length > 0 ? config.Aliases.Items.join(', ') : 'None'}`);

    // Check if already configured
    const hasCustomDomains = config.Aliases.Items.length > 0;
    const hasSSL = config.ViewerCertificate.ACMCertificateArn === sslCertificateArn;

    if (hasCustomDomains && hasSSL) {
      console.log('✅ Distribution already has custom domains and SSL configured');
      console.log(`   Aliases: ${config.Aliases.Items.join(', ')}`);
      console.log('   No update needed.');
      return;
    }

    // Update configuration to add SSL and custom domains
    console.log('\n🔧 Updating distribution configuration...');
    
    // Add custom domain aliases
    config.Aliases = {
      Quantity: 1,
      Items: [`*.${customDomainBase}`]
    };

    // Update SSL certificate
    config.ViewerCertificate = {
      ACMCertificateArn: sslCertificateArn,
      SSLSupportMethod: 'sni-only',
      MinimumProtocolVersion: 'TLSv1.2_2021',
      CertificateSource: 'acm'
    };

    // Update the distribution
    const updateParams = {
      Id: distributionId,
      DistributionConfig: config,
      IfMatch: etag
    };

    console.log('⏳ Applying configuration update...');
    const updateResult = await cloudFront.updateDistribution(updateParams).promise();

    console.log('✅ Distribution updated successfully!');
    console.log(`   Status: ${updateResult.Distribution.Status}`);
    console.log(`   Aliases: ${updateResult.Distribution.DistributionConfig.Aliases.Items.join(', ')}`);
    console.log(`   SSL Certificate: ${updateResult.Distribution.DistributionConfig.ViewerCertificate.ACMCertificateArn}`);

    console.log('\n🚀 Next Steps:');
    console.log('1. Wait for distribution to deploy (15-20 minutes)');
    console.log('2. Create DNS CNAME record:');
    console.log(`   *.${customDomainBase} -> ${process.env.SHARED_CLOUDFRONT_DOMAIN}`);
    console.log('3. Test custom domains:');
    console.log(`   https://tenant1.${customDomainBase}`);
    console.log(`   https://company.${customDomainBase}`);

    console.log('\n✨ Custom domains will be available once DNS propagates!');

  } catch (error) {
    console.error('\n❌ Failed to update distribution');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 'InvalidViewerCertificate') {
      console.error('\n💡 SSL Certificate Issue:');
      console.error('   - Ensure certificate is in us-east-1 region');
      console.error('   - Verify certificate covers *.junotech.in');
      console.error('   - Check certificate status is "Issued"');
    }
    
    if (error.code === 'CNAMEAlreadyExists') {
      console.error('\n💡 Domain Conflict:');
      console.error('   - Another CloudFront distribution may be using this domain');
      console.error('   - Check for conflicting distributions');
    }
    
    if (error.code === 'PreconditionFailed') {
      console.error('\n💡 Configuration Conflict:');
      console.error('   - Distribution was modified since we retrieved it');
      console.error('   - Try running the script again');
    }
    
    process.exit(1);
  }
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('\n💥 Unhandled error:', error.message);
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('\n💥 Script failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main };