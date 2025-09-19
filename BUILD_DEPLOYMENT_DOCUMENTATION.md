# 🏗️ **BUILD & DEPLOYMENT PROCESS - COMPLETE DOCUMENTATION**

## **📋 System Overview**

This is a **multi-tenant website builder backend** with **dynamic CloudFront distributions**. Each tenant gets their own isolated CloudFront distribution with unique `*.cloudfront.net` domains.

---

## **🔄 COMPLETE BUILD & DEPLOYMENT FLOW**

### **1. Upload Trigger** 
```
POST /api/builds/:tenantId
```
- User uploads ZIP file containing Next.js project
- Uploaded to S3 bucket: `user-app-codebase-uploads`
- Build job queued using Redis Bull queue

### **2. Build Processing Pipeline**

#### **Step 1: Environment Setup**
- Create temporary workspace: `/temp/builds/{buildId}/`
- Initialize directories: `temp/`, `source/`, `output/`

#### **Step 2: ZIP Download & Extraction**
- Download ZIP from S3: `tenants/{tenantId}/builds/{buildId}/source.zip`
- Extract using `adm-zip` to source directory
- Find actual project directory (handle nested folders)

#### **Step 3: Project Validation**
- Validate Next.js project structure
- Check for `package.json`, `next.config.js`, etc.

#### **Step 4: Dependency Installation**
- Run `npm install --legacy-peer-deps`
- **Simplified**: No forced Tailwind installation (removed!)
- Respects user's `package.json` dependencies

#### **Step 5: Environment Injection**
- Inject tenant-specific environment variables
- Configure build settings per tenant

#### **Step 6: Next.js Configuration**
- Auto-configure `next.config.js` for static export
- Set `output: 'export'` for static generation

#### **Step 7: Build Process**
- Run `npm run build` (production mode)
- Generate static assets in `/out` directory
- Handle build timeouts (15-minute limit)

#### **Step 8: Static Export**
- Export static files for CDN deployment
- Validate export contains required files
- Find `index.html` for proper routing

#### **Step 9: S3 Upload**
- Upload all static files to S3 bucket: `user-app-static-sites-uploads`
- Deployment path: `tenants/{tenantId}/deployments/{buildId}/`
- Preserve directory structure

#### **Step 10: CloudFront Distribution**
- **Get/Create tenant-specific CloudFront distribution**
- Each tenant gets unique distribution ID
- Domain format: `{random}.cloudfront.net`
- Origin points to tenant's S3 folder

#### **Step 11: Cache Invalidation**
- Invalidate CloudFront cache for immediate deployment
- Create invalidation for `/*` pattern
- Track invalidation ID for monitoring

#### **Step 12: Version Pointer Update**
- Update current deployment pointer
- Store metadata in database
- Track deployment history

#### **Step 13: Cleanup**
- Remove temporary build workspace
- Free disk space
- Clean up build artifacts

---

## **🏗️ KEY SERVICES BREAKDOWN**

### **buildService.js** - Core Build Engine
```javascript
// Main build processor
buildQueue.process('process-build', async (job) => {
  const { buildId, tenantId, storageKey, buildConfig } = job.data;
  // 13-step build process...
});
```

**Key Functions:**
- `processBuild()` - Main 13-step build pipeline
- `generateDeploymentUrl()` - Create tenant-specific URLs
- `uploadDirectoryToS3()` - Deploy static files
- `validateNextJsProject()` - Project validation

### **tenantDistributionService.js** - CloudFront Management
```javascript
class TenantDistributionService {
  static async createTenantDistribution(tenantId) {
    // Creates individual CloudFront distribution per tenant
  }
  
  static async getOrCreateTenantDistribution(tenantId) {
    // Returns existing or creates new distribution
  }
}
```

**Key Features:**
- **Individual distributions per tenant** (not shared)
- **Unique subdomains**: `d1a2b3c4d5e6f7.cloudfront.net`
- **S3 Origin configuration**: Points to tenant's folder
- **Error page handling**: 404/403 → index.html
- **Database integration**: Stores distribution metadata

### **deploymentService.js** - Deployment Orchestration
```javascript
async function deployToCloudFront(tenantId, version, buildPath) {
  // Get tenant distribution
  const distribution = await TenantDistributionService.getOrCreateTenantDistribution(tenantId);
  
  // Update version pointer
  await updateVersionPointer(tenantId, version);
  
  // Invalidate cache
  await TenantDistributionService.invalidateTenantCache(tenantId);
}
```

---

## **🔗 URL GENERATION LOGIC**

### **Final Deployment URLs:**
```
https://{distributionId}.cloudfront.net/deployments/{buildId}/
```

**Example:**
```
https://d1a2b3c4d5e6f7.cloudfront.net/deployments/abc123-def456/index.html
```

### **S3 Origin Structure:**
```
Bucket: user-app-static-sites-uploads
├── tenants/
│   ├── tenant-1/
│   │   ├── deployments/
│   │   │   ├── build-1/
│   │   │   │   ├── index.html
│   │   │   │   ├── _next/
│   │   │   │   └── assets/
│   │   │   └── build-2/
│   │   └── current.json (version pointer)
│   └── tenant-2/
└── pointers/
```

---

## **📡 API ENDPOINTS (Active)**

### **Core Routes:**
- `POST /api/builds/:tenantId` - Upload & build project
- `GET /api/builds/:tenantId/builds` - List builds
- `GET /api/builds/:tenantId/builds/:buildId` - Get build details
- `POST /api/builds/:tenantId/builds/:buildId/retry` - Retry failed build

### **Storage Management:**
- `GET /api/storage` - List S3 objects
- `DELETE /api/storage/object/:path` - Delete S3 objects
- `GET /api/storage/buckets` - List buckets

### **Authentication:**
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/verify-otp` - OTP verification

### **Tenant Management:**
- `GET /api/tenants` - List user's tenants
- `POST /api/tenants` - Create new tenant
- `GET /api/tenants/:tenantId` - Get tenant details

---

## **🧹 CLEANUP COMPLETED**

### **Removed Unused Routes:**
- ❌ `domains.js` - Custom domain management (not implemented)
- ❌ `deployments.js` - Legacy deployment routes
- ❌ `metrics.js` - Tenant metrics (not used)

### **Removed Unused Services:**
- ❌ `auditService.js` - Audit logging (not used)
- ❌ `securityService.js` - Security utilities (not used) 
- ❌ `tenantConfigService.js` - Tenant configuration (not used)

### **Removed Test Files:**
- ❌ `diagnose-cloudfront.js`
- ❌ `fix-cloudfront-origin.js`
- ❌ `test-*.js` files (9 files)
- ❌ `validate-deployment.js`

### **Removed Build Features:**
- ❌ **Tailwind Force-Installation** - No longer overwrites user's package.json
- ❌ Excessive build logging - Cleaner, focused logs
- ❌ Dependency verification loops - Trusts npm install

---

## **🎯 OPTIMIZATIONS MADE**

### **Build Process Improvements:**
1. **Simplified dependency installation** - No forced packages
2. **Reduced logging noise** - Focus on essential information  
3. **Faster builds** - Removed unnecessary validation steps
4. **User choice respected** - Projects manage their own dependencies

### **Code Quality:**
1. **Removed dead code** - ~500+ lines of unused code removed
2. **Cleaner architecture** - Only active routes and services remain
3. **Better maintainability** - Focused codebase easier to debug
4. **Reduced complexity** - Simpler build pipeline

---

## **🚀 DEPLOYMENT EXAMPLE**

```bash
# 1. User uploads ZIP file
curl -X POST https://api.example.com/api/builds/my-tenant-id \
  -F "file=@my-nextjs-project.zip"

# 2. System processes build (automatic)
# - Downloads ZIP from S3
# - Extracts and validates Next.js project  
# - Installs dependencies with npm install
# - Builds with npm run build
# - Uploads static files to S3
# - Creates/updates CloudFront distribution
# - Invalidates cache

# 3. Website goes live
# URL: https://d1a2b3c4d5e6f7.cloudfront.net/deployments/abc123/
```

---

## **💡 KEY BENEFITS**

### **Multi-Tenant Isolation:**
- Each tenant gets their own CloudFront distribution
- Complete isolation of deployments and traffic
- Unique subdomain per tenant

### **Dynamic Scaling:**
- Automatic CloudFront distribution creation
- No shared infrastructure bottlenecks
- Scales to unlimited tenants

### **Developer Experience:**
- Respects user's project structure
- No forced dependencies or frameworks
- Clean, informative build logs
- Fast build and deployment process

### **Production Ready:**
- AWS CloudFront CDN for global performance
- S3 static hosting for reliability
- Redis queue for scalable build processing
- PostgreSQL for persistent data storage

---

## **🔧 Environment Variables Required**

```env
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET_UPLOADS=user-app-codebase-uploads
AWS_S3_BUCKET_STATIC=user-app-static-sites-uploads

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Server
PORT=8000
NODE_ENV=production
```

This completes the comprehensive analysis and cleanup of the build and deployment system! 🎉