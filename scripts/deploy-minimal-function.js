require('dotenv').config();
const AWS = require('aws-sdk');

AWS.config.update({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const cloudfront = new AWS.CloudFront();

async function deployMinimalFunction() {
    try {
        console.log('🚀 DEPLOYING MINIMAL TEST FUNCTION');
        console.log('===================================\n');

        const functionName = 'tenant-routing-1758343255348';
        
        // Create a minimal working function that properly returns the request
        const minimalFunctionCode = `function handler(event) {
    var request = event.Records[0].cf.request;
    var headers = request.headers;
    var uri = request.uri;
    
    // Get the Host header to determine tenant
    var host = headers.host[0].value.toLowerCase();
    
    // Extract tenant ID from hostname
    var tenantId = null;
    var customDomainBase = 'junotech.in';
    
    // Handle custom domains: tenant123.junotech.in
    if (host.endsWith('.' + customDomainBase)) {
        var subdomain = host.replace('.' + customDomainBase, '');
        
        // Validate subdomain format
        if (subdomain && 
            subdomain !== 'www' && 
            subdomain !== 'api' && 
            subdomain !== 'admin' && 
            /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain) && 
            subdomain.length >= 3 && 
            subdomain.length <= 63) {
            tenantId = subdomain;
        }
    }
    
    // If we have a valid tenant ID, rewrite the request
    if (tenantId) {
        // Normalize URI
        if (uri === '' || uri === '/') {
            uri = '/index.html';
        }
        
        // Ensure URI starts with /
        if (!uri.startsWith('/')) {
            uri = '/' + uri;
        }
        
        // Route to physical /current/ directory
        var newUri = '/tenants/' + tenantId + '/deployments/current' + uri;
        
        console.log('Tenant routing: ' + host + uri + ' -> ' + newUri);
        
        request.uri = newUri;
        
        // Add headers for debugging
        request.headers['x-tenant-id'] = [{
            key: 'X-Tenant-Id',
            value: tenantId
        }];
    } else {
        // No tenant detected - serve error page
        console.log('No tenant detected for host: ' + host);
        request.uri = '/error/tenant-not-found.html';
    }
    
    // CRITICAL: Must return the request object
    return request;
}`;

        console.log('📝 Minimal function code length:', minimalFunctionCode.length, 'characters');
        
        // Test syntax locally first
        try {
            eval(minimalFunctionCode);
            console.log('✅ Function syntax is valid');
        } catch (syntaxError) {
            console.log('❌ Function syntax error:', syntaxError.message);
            return;
        }
        
        // Get current function to get ETag
        console.log('🔍 Getting current function state...');
        const currentFunction = await cloudfront.getFunction({
            Name: functionName
        }).promise();
        const etag = currentFunction.ETag;
        
        console.log('📝 Current ETag:', etag);
        
        // Update function code
        const updateParams = {
            Name: functionName,
            IfMatch: etag,
            FunctionCode: Buffer.from(minimalFunctionCode, 'utf8'),
            FunctionConfig: {
                Comment: 'Minimal tenant routing function - FIXED TO RETURN REQUEST',
                Runtime: 'cloudfront-js-1.0'
            }
        };
        
        console.log('🚀 Updating CloudFront Function...');
        const updateResult = await cloudfront.updateFunction(updateParams).promise();
        
        console.log('✅ Function updated successfully!');
        console.log('📝 New ETag:', updateResult.ETag);
        
        // Publish the function
        console.log('📤 Publishing function...');
        const publishParams = {
            Name: functionName,
            IfMatch: updateResult.ETag
        };
        
        const publishResult = await cloudfront.publishFunction(publishParams).promise();
        console.log('✅ Function published successfully!');
        
        // Test the function
        console.log('\n🧪 Testing the minimal function...');
        
        const testEvent = {
            "Records": [{
                "cf": {
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
            const testResult = await cloudfront.testFunction({
                Name: functionName,
                IfMatch: publishResult.FunctionSummary.FunctionMetadata.ETag,
                Stage: 'LIVE',
                EventObject: Buffer.from(JSON.stringify(testEvent))
            }).promise();

            console.log('✅ Function test successful!');
            const output = JSON.parse(testResult.TestResult.FunctionOutput);
            console.log('🔍 Returned URI:', output.uri);
            console.log('🔍 Returned headers:', Object.keys(output.headers || {}));
            
            if (output.uri && output.uri.includes('/tenants/') && output.uri.includes('/current/')) {
                console.log('✅ Function is correctly routing requests!');
            } else {
                console.log('❌ Function is not routing correctly');
            }
            
        } catch (testError) {
            console.log('❌ Function test failed:', testError.message);
        }
        
        console.log('\n🎉 MINIMAL FUNCTION DEPLOYMENT COMPLETED!');
        console.log('⏱️  Allow 5-10 minutes for global distribution');
        console.log('🔗 Test URL: https://himanshus-organization-clql5u68.junotech.in/index.html');
        
    } catch (error) {
        console.error('❌ Error deploying minimal function:', error);
    }
}

deployMinimalFunction();