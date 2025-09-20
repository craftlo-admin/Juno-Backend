#!/usr/bin/env node

require('dotenv').config();
const SharedDistributionSetupService = require('../src/services/sharedDistributionSetupService');
const logger = require('../src/utils/logger');

/**
 * Setup Script: Create Shared CloudFront Distribution
 * 
 * This script creates the shared CloudFront distribution that serves all tenants
 * in a multi-tenant architecture with proper DNS and SSL configuration.
 * 
 * Prerequisites:
 * - AWS credentials configured
 * - S3 bucket created (AWS_S3_BUCKET_STATIC)
 * - Optional: Wildcard SSL certificate in ACM (WILDCARD_SSL_CERTIFICATE_ARN)
 * - Optional: Route 53 hosted zone (ROUTE53_HOSTED_ZONE_ID)
 * 
 * Usage:
 * node scripts/setup-shared-distribution.js
 */

async function main() {
  console.log('🚀 Setting up Shared CloudFront Distribution');
  console.log('='.repeat(60));

  // Validate prerequisites
  console.log('\n📋 Checking prerequisites...');
  
  const requiredEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET_STATIC',
    'CUSTOM_DOMAIN_BASE'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('\nPlease add these to your .env file and try again.');
    process.exit(1);
  }

  console.log('✅ Required environment variables found');

  // Optional variables
  const optionalVars = [
    'WILDCARD_SSL_CERTIFICATE_ARN',
    'ROUTE53_HOSTED_ZONE_ID'
  ];

  optionalVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ Optional: ${varName} configured`);
    } else {
      console.log(`⚠️  Optional: ${varName} not configured`);
    }
  });

  // Initialize setup service
  const setupService = new SharedDistributionSetupService();

  // Check if distribution already exists
  console.log('\n🔍 Checking for existing shared distribution...');
  const status = await setupService.getSharedDistributionStatus();
  
  if (status.exists) {
    console.log('✅ Shared distribution already exists');
    console.log(`   Distribution ID: ${status.distributionId}`);
    console.log(`   Domain: ${status.domainName}`);
    console.log(`   Status: ${status.status}`);
    console.log(`   Aliases: ${status.aliases.join(', ')}`);
    
    const proceed = await askQuestion('\nDo you want to create a new distribution anyway? (y/N): ');
    if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
      console.log('✋ Setup cancelled. Using existing distribution.');
      process.exit(0);
    }
  }

  // Create shared distribution
  console.log('\n🏗️  Creating shared CloudFront distribution...');
  console.log('⏳ This may take a few minutes...');

  try {
    const result = await setupService.createSharedDistribution();
    
    console.log('\n🎉 Shared CloudFront distribution created successfully!');
    console.log('='.repeat(60));
    
    // Generate setup instructions
    const instructions = setupService.generateSetupInstructions(result);
    
    instructions.nextSteps.forEach(step => {
      console.log(step);
    });
    
    console.log('\n📝 Distribution Details:');
    console.log(`   ID: ${result.distributionId}`);
    console.log(`   Domain: ${result.domainName}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Function ARN: ${result.functionARN}`);
    
    // Save environment variables to a file
    const envContent = [
      '# Shared CloudFront Distribution Configuration',
      '# Add these to your .env file:',
      '',
      `SHARED_CLOUDFRONT_DISTRIBUTION_ID=${result.distributionId}`,
      `SHARED_CLOUDFRONT_DOMAIN=${result.domainName}`,
      ''
    ].join('\n');
    
    await require('fs').promises.writeFile('.env.cloudfront', envContent);
    console.log('\n💾 Environment variables saved to .env.cloudfront');
    console.log('   Please add these to your main .env file');

  } catch (error) {
    console.error('\n❌ Failed to create shared distribution');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 'TooManyDistributions') {
      console.error('\n💡 Suggestion: You may have reached the CloudFront distribution limit.');
      console.error('   Consider deleting unused distributions or requesting a quota increase.');
    }
    
    if (error.code === 'InvalidViewerCertificate') {
      console.error('\n💡 Suggestion: Check your SSL certificate ARN.');
      console.error('   Make sure the certificate is in us-east-1 region and covers your domain.');
    }
    
    process.exit(1);
  }
  
  console.log('\n🏁 Setup complete!');
  console.log('⏳ Distribution deployment will take 15-20 minutes to complete.');
  console.log('🔗 You can check status in the AWS CloudFront console.');
}

/**
 * Ask a question and wait for user input
 * @param {string} question - Question to ask
 * @returns {Promise<string>} - User's answer
 */
function askQuestion(question) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
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