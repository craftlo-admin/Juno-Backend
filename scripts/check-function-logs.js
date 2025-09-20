#!/usr/bin/env node

require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const cloudWatchLogs = new AWS.CloudWatchLogs();

async function checkCloudfrontLogs() {
  console.log('🔍 Checking CloudFront Function Logs');
  console.log('='.repeat(40));

  try {
    // CloudFront Function logs go to a specific log group
    const logGroupName = '/aws/cloudfront/function/tenant-routing-1758343255348';
    
    console.log(`📋 Looking for logs in: ${logGroupName}`);

    // Get recent log events
    const endTime = Date.now();
    const startTime = endTime - (24 * 60 * 60 * 1000); // Last 24 hours

    try {
      const logStreams = await cloudWatchLogs.describeLogStreams({
        logGroupName: logGroupName,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 5
      }).promise();

      if (logStreams.logStreams.length === 0) {
        console.log('❌ No log streams found');
        return;
      }

      console.log(`✅ Found ${logStreams.logStreams.length} log streams`);

      for (const stream of logStreams.logStreams.slice(0, 2)) {
        console.log(`\n📝 Log Stream: ${stream.logStreamName}`);
        console.log(`   Last Event: ${new Date(stream.lastEventTime).toISOString()}`);

        const events = await cloudWatchLogs.getLogEvents({
          logGroupName: logGroupName,
          logStreamName: stream.logStreamName,
          startTime: startTime,
          endTime: endTime,
          limit: 10
        }).promise();

        if (events.events.length > 0) {
          console.log(`   Recent events:`);
          events.events.forEach(event => {
            const timestamp = new Date(event.timestamp).toISOString();
            console.log(`   ${timestamp}: ${event.message}`);
          });
        } else {
          console.log(`   No recent events`);
        }
      }

    } catch (logError) {
      if (logError.code === 'ResourceNotFoundException') {
        console.log('❌ Log group not found - function may not be logging or have different name');
        
        // Try to list log groups to find the right one
        console.log('\n🔍 Searching for CloudFront function log groups...');
        const logGroups = await cloudWatchLogs.describeLogGroups({
          logGroupNamePrefix: '/aws/cloudfront'
        }).promise();
        
        console.log(`Found ${logGroups.logGroups.length} CloudFront log groups:`);
        logGroups.logGroups.forEach(group => {
          console.log(`   📁 ${group.logGroupName}`);
        });
        
      } else {
        throw logError;
      }
    }

  } catch (error) {
    console.error('❌ Failed to check CloudFront logs:', error.message);
  }
}

// Also try a direct test of the function
async function testFunctionDirectly() {
  console.log('\n🧪 Testing Function Directly');
  console.log('='.repeat(30));

  const cloudFront = new AWS.CloudFront();
  
  try {
    // Test the function with a sample event
    const testEvent = {
      Records: [{
        cf: {
          request: {
            uri: '/index.html',
            headers: {
              host: [{
                value: 'himanshus-organization-clql5u68.junotech.in'
              }]
            }
          }
        }
      }]
    };

    console.log('📋 Test event prepared');
    console.log('⚠️  Note: CloudFront Functions cannot be tested directly via API');
    console.log('   Real testing requires actual HTTP requests through CloudFront');

  } catch (error) {
    console.error('❌ Function test failed:', error.message);
  }
}

checkCloudfrontLogs().then(() => {
  return testFunctionDirectly();
});