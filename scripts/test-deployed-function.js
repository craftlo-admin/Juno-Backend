require('dotenv').config();
const AWS = require('aws-sdk');

AWS.config.update({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const cloudfront = new AWS.CloudFront();

async function testDeployedFunction() {
    try {
        console.log('🧪 TESTING DEPLOYED MINIMAL FUNCTION');
        console.log('====================================\n');

        const functionName = 'tenant-routing-1758343255348';
        
        // Get the latest function
        const functionInfo = await cloudfront.getFunction({ 
            Name: functionName,
            Stage: 'LIVE'
        }).promise();
        
        console.log('✅ Function found');
        console.log('   ETag:', functionInfo.ETag);
        console.log('   Code size:', functionInfo.FunctionCode.length, 'bytes');
        
        // Test the function with proper CloudFront Functions event format
        console.log('\n🧪 Testing function...');
        
        // CloudFront Functions use a different event format than Lambda@Edge
        const testEvent = {
            "version": "1.0",
            "context": {
                "eventType": "viewer-request"
            },
            "viewer": {
                "ip": "198.51.100.178"
            },
            "request": {
                "method": "GET",
                "uri": "/index.html",
                "querystring": {},
                "headers": {
                    "host": {
                        "value": "himanshus-organization-clql5u68.junotech.in"
                    }
                },
                "cookies": {}
            }
        };
        
        const testResult = await cloudfront.testFunction({
            Name: functionName,
            IfMatch: functionInfo.ETag,
            Stage: 'LIVE',
            EventObject: Buffer.from(JSON.stringify(testEvent))
        }).promise();

        console.log('✅ Function test successful!');
        
        const output = JSON.parse(testResult.TestResult.FunctionOutput);
        console.log('🔍 Function output:');
        console.log('   Original URI: /index.html');
        console.log('   Returned URI:', output.uri);
        console.log('   Method:', output.method);
        console.log('   Headers:', Object.keys(output.headers || {}));
        
        if (output.uri && output.uri.includes('/tenants/himanshus-organization-clql5u68/deployments/current/')) {
            console.log('✅ Function is correctly routing to /current/ directory!');
        } else {
            console.log('❌ Function is not routing correctly');
            console.log('   Expected: /tenants/himanshus-organization-clql5u68/deployments/current/index.html');
            console.log('   Got:', output.uri);
        }
        
        // Check logs
        if (testResult.TestResult.FunctionExecutionLogs && testResult.TestResult.FunctionExecutionLogs.length > 0) {
            console.log('\n📋 Function execution logs:');
            testResult.TestResult.FunctionExecutionLogs.forEach(log => {
                console.log('   ', log);
            });
        }
        
        console.log('\n🎯 CONCLUSION:');
        if (output.uri && output.uri.includes('/current/')) {
            console.log('✅ The function is working correctly!');
            console.log('🔗 Try accessing: https://himanshus-organization-clql5u68.junotech.in/index.html');
            console.log('⏱️  Allow 5-10 minutes for CloudFront distribution to propagate globally');
            console.log('');
            console.log('💡 The 503 error should now be resolved!');
        } else {
            console.log('❌ The function needs further debugging');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testDeployedFunction();