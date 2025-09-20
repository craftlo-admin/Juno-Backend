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

async function debugCloudfrontFunction() {
  console.log('🔍 Debugging CloudFront Function Issues');
  console.log('='.repeat(45));

  const functionName = 'tenant-routing-1758343255348';
  
  try {
    // Get current function code
    console.log('📋 Getting current function code...');
    const currentFunction = await cloudFront.getFunction({ Name: functionName }).promise();
    
    const functionCode = currentFunction.FunctionCode.toString('utf8');
    console.log(`\n📝 Current Function Code (${functionCode.length} chars):`);
    console.log('─'.repeat(50));
    console.log(functionCode);
    console.log('─'.repeat(50));
    
    // Check for syntax issues
    console.log('\n🔍 Syntax Analysis:');
    
    // Check if function starts and ends correctly
    const startsCorrectly = functionCode.trim().startsWith('function handler(event)');
    const endsCorrectly = functionCode.trim().endsWith('}');
    const hasReturnStatement = functionCode.includes('return request') || functionCode.includes('return {');
    
    console.log(`   ✅ Starts with handler: ${startsCorrectly}`);
    console.log(`   ✅ Ends with brace: ${endsCorrectly}`);
    console.log(`   ✅ Has return statement: ${hasReturnStatement}`);
    
    // Check for common issues
    const hasConsoleLog = functionCode.includes('console.log');
    const hasHostAccess = functionCode.includes('headers.host');
    const hasUriRewrite = functionCode.includes('request.uri =');
    
    console.log(`   📝 Has console.log: ${hasConsoleLog}`);
    console.log(`   🌐 Accesses host header: ${hasHostAccess}`);
    console.log(`   🔄 Rewrites URI: ${hasUriRewrite}`);
    
    // Try to validate JavaScript syntax
    try {
      new Function(functionCode);
      console.log('   ✅ JavaScript syntax is valid');
    } catch (syntaxError) {
      console.log(`   ❌ JavaScript syntax error: ${syntaxError.message}`);
    }
    
    // Check CloudFront Function limits
    console.log('\n📊 CloudFront Function Limits Check:');
    console.log(`   Code size: ${functionCode.length}/10,000 bytes (${((functionCode.length/10000)*100).toFixed(1)}%)`);
    
    // Test with a minimal function
    console.log('\n🧪 Creating minimal test function...');
    const minimalFunction = `function handler(event) {
    var request = event.Records[0].cf.request;
    console.log('Test function called, URI: ' + request.uri);
    return request;
}`;

    console.log('📝 Minimal test function:');
    console.log(minimalFunction);
    
    // Update with minimal function for testing
    console.log('\n⚠️  Want to deploy minimal test function? (This will help debug)');
    console.log('   Run: npm run cloudfront:test-minimal');
    
  } catch (error) {
    console.error('❌ Failed to debug CloudFront function:', error.message);
  }
}

debugCloudfrontFunction();