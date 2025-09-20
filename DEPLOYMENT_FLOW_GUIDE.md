# 🚀 Multi-Tenant Website Builder: Complete Deployment Flow Guide

## Overview
This guide explains the complete flow from ZIP file upload to live website deployment on `*.junotech.in` domains. The system is a sophisticated multi-tenant website builder that automatically processes Next.js projects and deploys them to AWS CloudFront with tenant-specific routing.

---

## 🏗️ Architecture Overview

### Core Components
1. **Upload System**: Handles ZIP file uploads with authentication
2. **Build Queue**: Redis-based queue system for processing builds
3. **Build Worker**: Processes Next.js projects and generates static builds
4. **Deployment Service**: Manages CloudFront deployments with strategy selection
5. **DNS Service**: Automates Route53 DNS record creation
6. **Routing Function**: CloudFront edge function for tenant-specific routing

### Deployment Strategies
- **Shared Distribution**: One CloudFront distribution serves all tenants (cost-effective)
- **Individual Distribution**: Each tenant gets their own CloudFront distribution (enterprise)

---

## 📋 Complete Flow: Upload to Live Website

### Phase 1: Upload & Authentication
```
User Upload → Authentication → File Validation → S3 Storage → Database Record
```

**Entry Point**: `POST /api/uploads/:tenantId`

**Process**:
1. **Authentication Check**
   ```javascript
   // src/routes/buildUploadRoutes.js
   router.post('/:tenantId', authenticateToken, authorizeTenant, upload.single('file'), UploadController.uploadFile);
   ```

2. **File Validation**
   - Checks file type (only `.zip` allowed)
   - Validates file size (max 100MB)
   - Ensures tenant authorization

3. **S3 Upload**
   ```javascript
   // src/controllers/UploadController.js
   const uploadPath = `uploads/${tenantId}/${Date.now()}-${file.originalname}`;
   await uploadToS3({
     key: uploadPath,
     body: file.buffer,
     bucket: process.env.AWS_S3_BUCKET_UPLOADS
   });
   ```

4. **Database Record Creation**
   ```javascript
   const build = await prisma.build.create({
     data: {
       tenantId,
       userId: req.user.id,
       version: `v${Date.now()}`,
       status: 'pending',
       uploadPath,
       framework: 'nextjs'
     }
   });
   ```

### Phase 2: Build Queue Processing
```
Database Record → Redis Queue → Build Worker → Processing
```

**Queue Management**:
```javascript
// src/services/buildService.js
const buildQueue = new Bull('build', {
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  }
});

await buildQueue.add('processBuild', {
  buildId: build.id,
  tenantId,
  version,
  uploadPath,
  buildConfig
});
```

### Phase 3: Build Processing
```
ZIP Download → Extraction → Security Scan → Dependency Install → Build → Upload
```

**Detailed Build Process** (`src/services/buildWorker.js`):

1. **Download & Extract**
   ```javascript
   // Download ZIP from S3
   const zipData = await getFromS3({
     key: uploadPath,
     bucket: process.env.AWS_S3_BUCKET_UPLOADS
   });
   
   // Extract to temporary directory
   const zip = new AdmZip(zipPath);
   zip.extractAllTo(extractDir, true);
   ```

2. **Security Validation**
   ```javascript
   // Check for malware and validate structure
   await scanForMalware(workDir);
   
   // Validate Next.js project structure
   const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
   if (!packageJson.dependencies?.next) {
     throw new Error('Not a Next.js project');
   }
   ```

3. **Tenant Configuration Injection**
   ```javascript
   // Generate tenant-specific config
   const tenantConfig = {
     tenantId,
     version,
     apiBaseUrl: process.env.API_BASE_URL,
     customDomain: `${tenantId}.junotech.in`
   };
   
   // Write config files
   await fs.writeFile(path.join(publicDir, 'tenant-config.json'), JSON.stringify(tenantConfig));
   
   // Create environment variables
   const envContent = [
     `NEXT_PUBLIC_TENANT_ID=${tenantId}`,
     `NEXT_PUBLIC_VERSION=${version}`,
     `NEXT_PUBLIC_API_BASE_URL=${process.env.API_BASE_URL}`
   ].join('\n');
   await fs.writeFile(path.join(sourceDir, '.env.local'), envContent);
   ```

4. **Build Process**
   ```javascript
   // Install dependencies
   await runCommand('npm', ['ci'], sourceDir);
   
   // Build the project
   await runCommand('npm', ['run', 'build'], sourceDir);
   
   // Generate static export
   await runCommand('npx', ['next', 'export'], sourceDir);
   ```

5. **Upload Build Artifacts**
   ```javascript
   const buildPath = `tenants/${tenantId}/${version}`;
   
   // Upload individual files for CloudFront serving
   await uploadDirectoryToS3(outputDir, buildPath);
   
   // Create archive for backup
   await uploadToS3({
     key: `${buildPath}/build.tar.gz`,
     body: await fs.readFile(archivePath),
     bucket: process.env.AWS_S3_BUCKET_STATIC
   });
   ```

### Phase 4: Deployment Strategy Selection
```
Build Complete → Strategy Selection → CloudFront Deployment → DNS Configuration
```

**Strategy Selection** (`src/services/deploymentService.js`):
```javascript
async function deployToCloudFront(tenantId, version, buildPath) {
  // Get tenant configuration
  const tenant = await prisma.tenant.findUnique({
    where: { tenantId }
  });
  
  // Select deployment strategy
  const strategy = await selectDeploymentStrategy(tenant);
  
  if (strategy === 'individual') {
    return await deployToIndividualDistribution(tenantId, version, buildPath);
  } else {
    return await deployToSharedDistribution(tenantId, version, buildPath);
  }
}
```

### Phase 5A: Shared Distribution Deployment (Recommended)
```
Strategy: Shared → Update Current Pointer → Cache Invalidation → DNS Setup
```

**Shared Deployment Process**:
```javascript
// src/services/sharedTenantDistributionService.js
async function deployToSharedDistribution(tenantId, version, buildPath) {
  // Update current version pointer
  await uploadToS3({
    key: `tenants/${tenantId}/deployments/current/index.html`,
    body: fs.readFileSync(path.join(buildPath, 'index.html')),
    bucket: process.env.AWS_S3_BUCKET_STATIC
  });
  
  // Copy all files to current deployment
  await copyS3Directory(
    `tenants/${tenantId}/${version}`,
    `tenants/${tenantId}/deployments/current`
  );
  
  // Invalidate CloudFront cache for tenant paths
  const paths = [
    `/tenants/${tenantId}/deployments/current/*`,
    `/tenants/${tenantId}/deployments/current/index.html`
  ];
  
  await cloudFront.createInvalidation({
    DistributionId: process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID,
    InvalidationBatch: {
      CallerReference: `tenant-${tenantId}-${Date.now()}`,
      Paths: { Quantity: paths.length, Items: paths }
    }
  }).promise();
}
```

### Phase 5B: Individual Distribution Deployment (Enterprise)
```
Strategy: Individual → Create Distribution → Configure Domain → DNS Setup
```

**Individual Deployment Process**:
```javascript
// src/services/tenantDistributionService.js
async function createTenantDistribution(tenantId) {
  // Generate unique subdomain
  const subdomain = `${tenantId}.junotech.in`;
  
  // Create CloudFront distribution
  const distributionConfig = {
    CallerReference: `tenant-${tenantId}-${Date.now()}`,
    Aliases: {
      Quantity: 1,
      Items: [subdomain]
    },
    DefaultRootObject: 'index.html',
    Origins: {
      Quantity: 1,
      Items: [{
        Id: `S3-${process.env.AWS_S3_BUCKET_STATIC}`,
        DomainName: `${process.env.AWS_S3_BUCKET_STATIC}.s3.amazonaws.com`,
        S3OriginConfig: {
          OriginAccessIdentity: ''
        }
      }]
    },
    DefaultCacheBehavior: {
      TargetOriginId: `S3-${process.env.AWS_S3_BUCKET_STATIC}`,
      ViewerProtocolPolicy: 'redirect-to-https'
    }
  };
  
  const result = await cloudFront.createDistribution({
    DistributionConfig: distributionConfig
  }).promise();
  
  return result.Distribution;
}
```

### Phase 6: DNS Configuration
```
Distribution Ready → Route53 Record → Domain Resolution → Live Website
```

**DNS Setup** (`src/services/dnsService.js`):
```javascript
async function createTenantDNSRecord(tenantId, cloudfrontDomain) {
  const subdomain = `${tenantId}.junotech.in`;
  
  const params = {
    HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
    ChangeBatch: {
      Comment: `DNS record for tenant ${tenantId}`,
      Changes: [{
        Action: 'CREATE',
        ResourceRecordSet: {
          Name: subdomain,
          Type: 'CNAME',
          TTL: 300,
          ResourceRecords: [{
            Value: cloudfrontDomain
          }]
        }
      }]
    }
  };
  
  const result = await route53.changeResourceRecordSets(params).promise();
  return result.ChangeInfo.Id;
}
```

### Phase 7: CloudFront Edge Routing (Shared Strategy)
```
Request → CloudFront Function → Tenant Resolution → Content Delivery
```

**Edge Function** (`src/cloudfront/tenant-routing-function.js`):
```javascript
function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;
  
  // Extract tenant ID from subdomain
  // Example: tenant123.junotech.in → tenant123
  var tenantId = host.split('.')[0];
  
  // Rewrite URI to tenant-specific path
  // Original: /
  // Rewritten: /tenants/tenant123/deployments/current/
  if (request.uri === '/' || request.uri === '') {
    request.uri = `/tenants/${tenantId}/deployments/current/index.html`;
  } else {
    request.uri = `/tenants/${tenantId}/deployments/current${request.uri}`;
  }
  
  return request;
}
```

---

## 🌐 Example Case: Complete Flow

### Scenario
User "John Doe" uploads a Next.js project to deploy on `johndoe-org-a1b2c3d4.junotech.in`

### Step-by-Step Process

#### 1. Upload (t=0s)
```bash
POST /api/uploads/johndoe-org-a1b2c3d4
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: multipart/form-data
File: my-nextjs-app.zip (15MB)
```

**Result**: 
- File uploaded to S3: `s3://user-app-codebase-uploads/uploads/johndoe-org-a1b2c3d4/1704067200000-my-nextjs-app.zip`
- Build record created: `build_uuid_123` with status `pending`

#### 2. Queue Processing (t=1s)
```javascript
// Build job added to Redis queue
{
  buildId: 'build_uuid_123',
  tenantId: 'johndoe-org-a1b2c3d4',
  version: 'v1704067200000',
  uploadPath: 'uploads/johndoe-org-a1b2c3d4/1704067200000-my-nextjs-app.zip'
}
```

#### 3. Build Processing (t=2s - t=45s)
```bash
# Download and extract
/tmp/build-build_uuid_123-1704067200000/
├── source/
│   ├── package.json
│   ├── next.config.js
│   ├── pages/
│   └── public/

# Install dependencies
npm ci

# Inject tenant config
public/tenant-config.json:
{
  "tenantId": "johndoe-org-a1b2c3d4",
  "version": "v1704067200000",
  "customDomain": "johndoe-org-a1b2c3d4.junotech.in"
}

.env.local:
NEXT_PUBLIC_TENANT_ID=johndoe-org-a1b2c3d4
NEXT_PUBLIC_VERSION=v1704067200000

# Build
npm run build
npx next export

# Output structure
out/
├── index.html
├── _next/
├── static/
└── ...
```

#### 4. Upload Build Artifacts (t=46s - t=50s)
```bash
# S3 structure after upload
s3://user-app-static-sites-uploads/
└── tenants/
    └── johndoe-org-a1b2c3d4/
        ├── v1704067200000/           # Versioned build
        │   ├── index.html
        │   ├── _next/
        │   └── static/
        └── deployments/
            └── current/              # Current deployment pointer
                ├── index.html
                ├── _next/
                └── static/
```

#### 5. Deployment Strategy (t=51s)
```javascript
// Check tenant configuration
const tenant = await prisma.tenant.findUnique({
  where: { tenantId: 'johndoe-org-a1b2c3d4' }
});

// Strategy: shared (default for standard tier)
deploymentStrategy: 'shared'
subscriptionTier: 'standard'
```

#### 6. Shared Distribution Deployment (t=52s - t=55s)
```javascript
// Update current deployment
await copyS3Directory(
  'tenants/johndoe-org-a1b2c3d4/v1704067200000',
  'tenants/johndoe-org-a1b2c3d4/deployments/current'
);

// Invalidate CloudFront cache
CloudFront Invalidation: E2QWRTYUIOP123
Paths: [
  '/tenants/johndoe-org-a1b2c3d4/deployments/current/*'
]
Distribution: E21LRYPVGD34E4 (shared)
```

#### 7. DNS Configuration (t=56s - t=58s)
```javascript
// Create Route53 CNAME record
Record: johndoe-org-a1b2c3d4.junotech.in
Type: CNAME
Value: d1234567890.cloudfront.net
TTL: 300
Status: PENDING → INSYNC
```

#### 8. Live Website (t=60s - t=120s)
```bash
# DNS propagation (0-60s)
nslookup johndoe-org-a1b2c3d4.junotech.in
Answer: d1234567890.cloudfront.net

# CloudFront cache invalidation (30-90s)
Cache Status: COMPLETED

# Website accessible
curl -I https://johndoe-org-a1b2c3d4.junotech.in
HTTP/2 200
server: CloudFront
```

#### 9. Request Flow (Production)
```bash
User Request: https://johndoe-org-a1b2c3d4.junotech.in/about

1. DNS Resolution:
   johndoe-org-a1b2c3d4.junotech.in → d1234567890.cloudfront.net

2. CloudFront Edge Function:
   Input URI: /about
   Host: johndoe-org-a1b2c3d4.junotech.in
   Extract tenant: johndoe-org-a1b2c3d4
   Rewrite URI: /tenants/johndoe-org-a1b2c3d4/deployments/current/about

3. S3 Origin:
   Fetch: s3://user-app-static-sites-uploads/tenants/johndoe-org-a1b2c3d4/deployments/current/about

4. Response:
   Content delivered with CloudFront caching
```

---

## 📊 System Performance & Scaling

### Timing Breakdown
- **Upload**: 1-2 seconds
- **Queue Processing**: 1 second
- **Build Process**: 30-60 seconds (depends on project size)
- **Deployment**: 5-10 seconds
- **DNS Propagation**: 30-300 seconds
- **Total Time to Live**: 1-6 minutes

### Scalability Features
- **Horizontal Scaling**: Multiple build workers can process builds concurrently
- **Resource Limits**: Build timeout (15 minutes), file size limits (100MB)
- **Queue Management**: Redis ensures builds are processed in order
- **Cost Optimization**: Shared CloudFront distribution reduces costs by 99.8%

### Monitoring & Logging
```javascript
// Build status tracking
Build Status: pending → processing → completed → deployed
Deployment Status: uploading → invalidating → dns_updating → live

// Database records
builds: { status, startedAt, finishedAt, errorMessage }
deployments: { status, deployedAt, cloudfrontInvalidationId }
```

---

## 🛠️ Configuration & Environment

### Required Environment Variables
```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_S3_BUCKET_UPLOADS=user-app-codebase-uploads
AWS_S3_BUCKET_STATIC=user-app-static-sites-uploads

# CloudFront (Shared Strategy)
SHARED_CLOUDFRONT_DISTRIBUTION_ID=E21LRYPVGD34E4
SHARED_CLOUDFRONT_DOMAIN=d1234567890.cloudfront.net

# DNS Configuration
ROUTE53_ENABLED=true
ROUTE53_HOSTED_ZONE_ID=Z1PA6795UKMFR9
CUSTOM_DOMAIN_BASE=junotech.in

# Deployment Strategy
DEFAULT_DEPLOYMENT_STRATEGY=shared
ENABLE_INDIVIDUAL_FOR_ENTERPRISE=true
```

### Database Schema (Key Models)
```sql
-- Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR UNIQUE,
  domain VARCHAR UNIQUE,
  deployment_strategy deployment_strategy_enum,
  subscription_tier subscription_tier_enum,
  cloudfront_distribution_id VARCHAR,
  primary_domain VARCHAR
);

-- Builds
CREATE TABLE builds (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR REFERENCES tenants(tenant_id),
  version VARCHAR,
  status VARCHAR,
  upload_path VARCHAR,
  build_path VARCHAR
);

-- Deployments
CREATE TABLE deployments (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR REFERENCES tenants(tenant_id),
  build_id UUID REFERENCES builds(id),
  version VARCHAR,
  status VARCHAR,
  cloudfront_invalidation_id VARCHAR
);
```

---

## 🔒 Security & Best Practices

### Security Measures
1. **File Validation**: Only ZIP files accepted, size limits enforced
2. **Malware Scanning**: Uploaded files scanned before processing
3. **Sandboxed Builds**: Builds run in isolated temporary directories
4. **Access Control**: JWT authentication and tenant authorization
5. **Input Sanitization**: All inputs validated and sanitized

### Production Considerations
1. **Error Handling**: Comprehensive error logging and recovery
2. **Resource Management**: Automatic cleanup of temporary files
3. **Rate Limiting**: API rate limits to prevent abuse
4. **Monitoring**: CloudWatch integration for build and deployment metrics
5. **Backup Strategy**: Build artifacts stored with versioning

---

## 🚀 Future Enhancements

### Planned Features
1. **Custom Domains**: Support for user-provided custom domains
2. **Build Caching**: Cache node_modules for faster builds
3. **Preview Deployments**: Deploy to staging environments
4. **Rollback Functionality**: Quick rollback to previous versions
5. **Build Analytics**: Detailed build performance metrics

### Optimization Opportunities
1. **CDN Optimization**: Advanced caching strategies
2. **Build Parallelization**: Parallel processing of build steps
3. **Resource Pooling**: Reuse build environments
4. **Auto-scaling**: Dynamic scaling based on build queue length

---

This guide provides a complete understanding of how a simple ZIP file upload becomes a live, accessible website on the `*.junotech.in` domain through sophisticated automation and AWS infrastructure management.