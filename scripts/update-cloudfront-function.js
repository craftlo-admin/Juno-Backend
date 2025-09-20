#!/usr/bin/env node

require('dotenv').config();
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const cloudFront = new AWS.CloudFront();

async function updateCloudfrontFunction() {
  console.log('🔧 Updating CloudFront Function');
  console.log('='.repeat(35));

  const functionName = 'tenant-routing-1758343255348';
  
  try {
    // Load the complete function code
    const functionPath = path.join(__dirname, '../src/cloudfront/tenant-routing-function.js');
    console.log(`📁 Loading function from: ${functionPath}`);
    
    const functionCode = fs.readFileSync(functionPath, 'utf8');
    
    // Extract just the handler function
    const functionMatch = functionCode.match(/function handler\(event\)\s*{([\s\S]*?)}\s*(?:\/\*|$)/m);
    if (!functionMatch) {
      throw new Error('Could not extract handler function from tenant-routing-function.js');
    }
    
    const cleanFunctionCode = `function handler(event) {${functionMatch[1]}}`;
    
    console.log('📝 Function code extracted successfully');
    console.log(`   Length: ${cleanFunctionCode.length} characters`);
    
    // Get current function to get ETag
    console.log('\n🔍 Getting current function configuration...');
    const currentFunction = await cloudFront.getFunction({ Name: functionName }).promise();
    
    console.log(`   Current ETag: ${currentFunction.ETag}`);
    console.log(`   Current size: ${currentFunction.FunctionCode.length} bytes`);
    
    // Update the function
    console.log('\n⏳ Updating function code...');
    const updateResult = await cloudFront.updateFunction({
      Name: functionName,
      IfMatch: currentFunction.ETag,
      FunctionCode: Buffer.from(cleanFunctionCode, 'utf8'),
      FunctionConfig: {
        Comment: 'Shared tenant routing function - UPDATED',
        Runtime: 'cloudfront-js-1.0'
      }
    }).promise();
    
    console.log('✅ Function updated successfully!');
    console.log(`   New ETag: ${updateResult.ETag}`);
    
    // Publish the function
    console.log('\n📦 Publishing updated function...');
    const publishResult = await cloudFront.publishFunction({
      Name: functionName,
      IfMatch: updateResult.ETag
    }).promise();
    
    console.log('✅ Function published successfully!');
    console.log(`   Published ETag: ${publishResult.ETag}`);
    console.log(`   Function ARN: ${publishResult.FunctionSummary.FunctionConfig.FunctionArn}`);
    
    console.log('\n🚀 Function update complete!');
    console.log('   CloudFront will start using the updated function within a few minutes.');
    console.log('   Test the URL again after 2-3 minutes.');
    
  } catch (error) {
    console.error('❌ Failed to update CloudFront function:', error.message);
    
    if (error.code === 'NoSuchResource') {
      console.error('\n💡 Function not found:');
      console.error('   - Check that the function name is correct');
      console.error('   - Verify the function exists in CloudFront console');
    }
    
    if (error.code === 'PreconditionFailed') {
      console.error('\n💡 ETag mismatch:');
      console.error('   - Function was modified since we retrieved it');
      console.error('   - Try running the script again');
    }
    
    throw error;
  }
}

updateCloudfrontFunction();