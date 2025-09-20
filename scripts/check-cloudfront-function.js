#!/usr/bin/env node

require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const cloudFront = new AWS.CloudFront();

async function checkCloudfrontFunction() {
  console.log('🔍 Checking CloudFront Function Configuration');
  console.log('='.repeat(50));

  const distributionId = process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID;

  try {
    // Get distribution configuration to see the function
    console.log('📋 Getting distribution configuration...');
    const distribution = await cloudFront.getDistribution({ Id: distributionId }).promise();
    const config = distribution.Distribution.DistributionConfig;

    // Check default cache behavior for function association
    const defaultBehavior = config.DefaultCacheBehavior;
    
    console.log('🔧 Default Cache Behavior:');
    console.log(`   Target Origin: ${defaultBehavior.TargetOriginId}`);
    console.log(`   Viewer Protocol Policy: ${defaultBehavior.ViewerProtocolPolicy}`);
    
    if (defaultBehavior.FunctionAssociations && defaultBehavior.FunctionAssociations.Items.length > 0) {
      console.log('\n📦 Function Associations:');
      for (const func of defaultBehavior.FunctionAssociations.Items) {
        console.log(`   Event Type: ${func.EventType}`);
        console.log(`   Function ARN: ${func.FunctionARN}`);
        
        // Extract function name from ARN
        const functionName = func.FunctionARN.split('/').pop();
        console.log(`   Function Name: ${functionName}`);
        
        // Get function details
        try {
          const functionDetails = await cloudFront.getFunction({ Name: functionName }).promise();
          console.log(`   Function Status: ${functionDetails.ETag ? 'Active' : 'Unknown'}`);
          
          // Get function code
          const functionCode = functionDetails.FunctionCode.toString('utf8');
          console.log('\n📝 Function Code:');
          console.log('─'.repeat(40));
          console.log(functionCode);
          console.log('─'.repeat(40));
          
        } catch (funcError) {
          console.error(`   ❌ Error getting function details: ${funcError.message}`);
        }
      }
    } else {
      console.log('\n⚠️  No function associations found on default cache behavior');
    }

    // Check origins
    console.log('\n🌐 Origins:');
    for (const origin of config.Origins.Items) {
      console.log(`   Origin ID: ${origin.Id}`);
      console.log(`   Domain: ${origin.DomainName}`);
      console.log(`   Origin Path: ${origin.OriginPath || '(none)'}`);
    }

  } catch (error) {
    console.error('❌ Failed to check CloudFront function:', error.message);
  }
}

checkCloudfrontFunction();