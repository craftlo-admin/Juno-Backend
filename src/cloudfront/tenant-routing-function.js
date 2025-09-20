/**
 * CloudFront Function for Shared Tenant Distribution (CORRECTED VERSION)
 * 
 * CRITICAL FIX: This function now routes to a physical /current/ directory
 * that must be maintained by the deployment service to contain the latest build.
 * 
 * Deployment: This function should be deployed to CloudFront and associated
 * with the shared distribution's "viewer-request" event.
 * 
 * Performance: CloudFront Functions are lightweight and execute in <1ms
 * Cost: ~$0.10 per 1 million invocations
 * 
 * IMPORTANT: The deployment service must create/update a physical "current"
 * directory for each tenant that copies or symlinks to the latest buildId.
 */

function handler(event) {
    var request = event.Records[0].cf.request;
    var headers = request.headers;
    var uri = request.uri;
    
    // Get the Host header to determine tenant
    var host = headers.host[0].value.toLowerCase();
    
    // Extract tenant ID from hostname
    var tenantId = null;
    
    // Configuration - domain base is passed as environment variable
    var customDomainBase = event.request.headers['x-domain-base'] ? 
        event.request.headers['x-domain-base'][0].value : 
        'builderfun.com'; // Fallback domain
    
    // Handle custom domains: tenant123.junotech.in
    if (host.endsWith('.' + customDomainBase)) {
        var subdomain = host.replace('.' + customDomainBase, '');
        
        // Validate subdomain format and exclude reserved subdomains
        if (subdomain && 
            subdomain !== 'www' && 
            subdomain !== 'api' && 
            subdomain !== 'admin' && 
            subdomain !== 'cdn' &&
            subdomain !== 'mail' &&
            /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain) && // Valid hostname format
            subdomain.length >= 3 && 
            subdomain.length <= 63) {
            tenantId = subdomain;
        }
    }
    
    // Handle direct CloudFront access: d1234567890123.cloudfront.net
    else if (host.includes('.cloudfront.net')) {
        // Try to extract tenant from path: /tenant-abc123/file.html
        var pathMatch = uri.match(/^\/tenant-([a-zA-Z0-9-]+)(\/.*)?$/);
        if (pathMatch) {
            tenantId = pathMatch[1];
            // Remove tenant prefix from URI for cleaner rewrite
            uri = pathMatch[2] || '/';
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
        
        // CORRECTED: Route to physical /current/ directory that must exist
        // The deployment service is responsible for maintaining this directory
        var newUri = '/tenants/' + tenantId + '/deployments/current' + uri;
        
        // Log the rewrite for debugging (visible in CloudWatch)
        console.log('Tenant routing: ' + host + uri + ' -> ' + newUri);
        
        request.uri = newUri;
        
        // Add custom headers for debugging and analytics
        request.headers['x-tenant-id'] = [{
            key: 'X-Tenant-Id',
            value: tenantId
        }];
        
        request.headers['x-original-host'] = [{
            key: 'X-Original-Host', 
            value: host
        }];
        
        request.headers['x-original-uri'] = [{
            key: 'X-Original-Uri',
            value: uri
        }];
        
        // Add cache control for better performance
        request.headers['cache-control'] = [{
            key: 'Cache-Control',
            value: 'public, max-age=300' // 5 minutes cache
        }];
    }
    else {
        // No tenant detected - serve default content or error page
        console.log('No tenant detected for host: ' + host);
        
        // Serve a default error page that explains the issue
        request.uri = '/error/tenant-not-found.html';
        
        // Alternative: Redirect to main website
        /*
        return {
            status: '302',
            statusDescription: 'Found',
            headers: {
                location: [{
                    key: 'Location',
                    value: 'https://' + customDomainBase
                }]
            }
        };
        */
    }
    
    return request;
}

/* 
DEPLOYMENT INSTRUCTIONS & CRITICAL REQUIREMENTS:

**BEFORE DEPLOYING THIS FUNCTION:**

The deployment service MUST be updated to create physical "current" directories.
Currently, the system creates:
- /tenants/tenant123/deployments/build-001/
- /tenants/tenant123/deployments/build-002/

But this function expects:
- /tenants/tenant123/deployments/current/ (containing latest build files)

**REQUIRED DEPLOYMENT SERVICE CHANGES:**

1. After uploading new build to /tenants/{tenantId}/deployments/{buildId}/
2. Copy all files to /tenants/{tenantId}/deployments/current/
3. Or create S3 object copies pointing to current build
4. Update on each new deployment

**AWS DEPLOYMENT:**

1. Create CloudFront Function in AWS Console:
   - Go to CloudFront > Functions
   - Click "Create function"
   - Name: "tenant-routing-function"
   - Runtime: "cloudfront-js-1.0"
   - Copy this code into the function editor

2. Test the function:
   Test cases:
   * Host: "tenant123.junotech.in" -> routes to /tenants/tenant123/deployments/current/index.html
   * Host: "tenant123.junotech.in", URI: "/about.html" -> routes to /tenants/tenant123/deployments/current/about.html

3. Publish and Associate:
   - Publish the function
   - Associate with shared CloudFront distribution "viewer-request" event
   - Deploy distribution changes

**MONITORING:**
- Function logs appear in CloudWatch
- Monitor routing success/failure rates
- Check for 404 errors indicating missing /current/ directories

**COST OPTIMIZATION:**
- CloudFront Functions: ~$0.10 per 1M invocations
- Much cheaper than Lambda@Edge
- No cold starts, sub-millisecond execution

**ALTERNATIVE ARCHITECTURES:**
If maintaining /current/ directories becomes complex, consider:
1. Lambda@Edge (higher cost but can read pointer files)
2. Preprocessed DNS with build IDs
3. Client-side routing with API calls
*/