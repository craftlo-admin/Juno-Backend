require('dotenv').config();
const AWS = require('aws-sdk');

AWS.config.update({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const cloudfront = new AWS.CloudFront();

async function testCloudFrontFunction() {
    try {
        console.log('🧪 TESTING CloudFront Function');
        console.log('===============================\n');

        const functionName = 'tenant-routing-1758343255348';
        
        // Get function info
        console.log('📋 Getting function information...');
        const functionInfo = await cloudfront.getFunction({ 
            Name: functionName,
            Stage: 'LIVE'
        }).promise();
        
        console.log('✅ Function found');
        console.log('   ETag:', functionInfo.ETag);
        console.log('   Code size:', functionInfo.FunctionCode.length, 'bytes');
        
        // Check function description for better details
        const describeResult = await cloudfront.describeFunction({ Name: functionName }).promise();
        console.log('   Status:', describeResult.FunctionSummary.Status);
        console.log('   Stage:', describeResult.FunctionSummary.Stage);
        
        // Get the function code to check for issues
        console.log('\n📝 Function code preview:');
        const functionCode = functionInfo.FunctionCode.toString('utf8');
        console.log('First 300 characters:');
        console.log(functionCode.substring(0, 300) + '...');
        
        // Test with properly formatted event
        console.log('\n🧪 Testing function with CloudFront event...');
        
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

        try {
            const testResult = await cloudfront.testFunction({
                Name: functionName,
                IfMatch: functionInfo.ETag,
                Stage: 'LIVE',
                EventObject: Buffer.from(JSON.stringify(testEvent))
            }).promise();

            console.log('✅ Function test successful!');
            console.log('🔍 Test result:');
            console.log(JSON.stringify(testResult.TestResult.FunctionOutput, null, 2));
            
            if (testResult.TestResult.FunctionExecutionLogs) {
                console.log('📋 Execution logs:');
                console.log(testResult.TestResult.FunctionExecutionLogs);
            }
            
        } catch (testError) {
            console.log('❌ Function test failed:', testError.message);
            console.log('   Code:', testError.code);
            
            // Try with legacy CloudFront event format
            console.log('\n🔄 Trying with legacy CloudFront event format...');
            
            const legacyEvent = {
                "Records": [{
                    "cf": {
                        "config": {
                            "distributionId": "E21LRYPVGD34E4"
                        },
                        "request": {
                            "uri": "/index.html",
                            "method": "GET",
                            "headers": {
                                "host": [{
                                    "key": "Host",
                                    "value": "himanshus-organization-clql5u68.junotech.in"
                                }]
                            }
                        }
                    }
                }]
            };
            
            try {
                const legacyTestResult = await cloudfront.testFunction({
                    Name: functionName,
                    IfMatch: functionInfo.ETag,
                    Stage: 'LIVE',
                    EventObject: Buffer.from(JSON.stringify(legacyEvent))
                }).promise();

                console.log('✅ Legacy format test successful!');
                console.log('🔍 Test result:');
                console.log(JSON.stringify(legacyTestResult.TestResult.FunctionOutput, null, 2));
                
            } catch (legacyError) {
                console.log('❌ Legacy format also failed:', legacyError.message);
                
                // Check if there's a syntax error in the function
                console.log('\n🔍 Checking for syntax errors...');
                try {
                    // Try to evaluate the function code
                    eval(functionCode);
                    console.log('✅ Function syntax appears valid');
                } catch (syntaxError) {
                    console.log('❌ SYNTAX ERROR FOUND:', syntaxError.message);
                    console.log('   This is likely the cause of the 503 error!');
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testCloudFrontFunction();