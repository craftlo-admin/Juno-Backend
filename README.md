# Multi-Tenant Website Deployment Backend

A comprehensive Express.js backend system for deploying and managing multi-tenant Next.js websites with Supabase, Prisma ORM, AWS integration, automated builds, and custom domain support.

## 🏗️ Architecture Overview

This system implements a complete multi-tenant SaaS platform that allows users to:
- Upload Next.js static websites as ZIP files
- Automatically build and deploy sites to AWS infrastructure
- Serve sites on custom subdomains (tenant-id.myapp.com)
- Manage deployments, rollbacks, and custom domains
- Monitor usage and performance metrics

### Core Components

1. **Control Plane**: Express.js MVC application with Supabase PostgreSQL & Prisma ORM
2. **Build Workers**: Isolated container-based build environment
3. **Static Hosting**: AWS S3 + CloudFront for global content delivery
4. **DNS & TLS**: Route53 + ACM for domain management
5. **Security**: Malware scanning, sandboxed builds, audit logging

## 🚀 Features

- **Multi-tenant Architecture**: Isolated deployments per tenant
- **Automated CI/CD**: ZIP upload → Build → Deploy → Live site
- **Custom Domains**: Support for tenant-owned domains
- **Security First**: Malware scanning, sandboxed builds
- **Type-safe Database**: Prisma ORM with TypeScript support
- **Modern Database**: Supabase PostgreSQL with real-time capabilities
- **Scalable**: Redis-based job queue, AWS auto-scaling
- **Monitoring**: Comprehensive logging and audit trails
- **API-First**: RESTful APIs for all operations

## 📋 Prerequisites

- Node.js 18+
- Supabase Project (or PostgreSQL 12+)
- Redis 6+
- AWS Account with appropriate services
- (Optional) ClamAV for malware scanning

## 🎯 New: Supabase + Prisma Migration

This project has been migrated from Knex.js to **Prisma ORM** with **Supabase** integration. See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for detailed migration instructions.

## 🔧 Installation

1. **Clone and install dependencies:**
```bash
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Set up Supabase & Database:**

**Option A: Using Supabase (Recommended)**
```bash
# 1. Create a Supabase project at https://supabase.com
# 2. Copy your DATABASE_URL from Supabase dashboard
# 3. Add DATABASE_URL to your .env file

# Generate Prisma client
npm run db:generate

# Deploy database schema
npm run db:migrate:deploy

# (Optional) Seed data
npm run db:seed
```

**Option B: Local PostgreSQL**
```bash
# Create database
createdb website_deployment_db

# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# (Optional) Seed data
npm run db:seed
```

📖 **See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for detailed setup instructions**

4. **Start Redis:**
```bash
# Ubuntu/Debian
sudo systemctl start redis-server

# macOS with Homebrew
brew services start redis

# Docker
docker run -d -p 6379:6379 redis:alpine
```

## 🏃 Running the Application

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### Database Operations
```bash
# Generate Prisma client
npm run db:generate

# Deploy migrations to production
npm run db:migrate:deploy

# Push schema changes (development)
npm run db:push

# Open Prisma Studio GUI
npm run db:studio

# Reset database (development only)
npm run db:reset

# Seed database
npm run db:seed
```

## 🔐 Environment Configuration

Key environment variables to configure:

### Database (Supabase + Prisma)
```env
# Supabase connection string
DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres?pgbouncer=true&connection_limit=1"

# Optional: Direct connection for migrations
DIRECT_DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"

# Legacy (if using local PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=website_deployment_db
DB_USER=postgres
DB_PASSWORD=your_password
```

### AWS Configuration
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_S3_BUCKET_UPLOADS=myapp-uploads
AWS_S3_BUCKET_STATIC=myapp-static-sites
AWS_CLOUDFRONT_DISTRIBUTION_ID=your_distribution_id
```

### Application Settings
```env
JWT_SECRET=your_super_secret_jwt_key
BASE_DOMAIN=myapp.com
API_BASE_URL=https://api.myapp.com
```

## 🌐 API Documentation

### Authentication
```bash
# Register user
POST /api/auth/register
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe"
}

# Login
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### Tenant Management
```bash
# Create tenant
POST /api/tenants
Authorization: Bearer <token>
{
  "name": "My Website",
  "description": "A sample website"
}

# Get tenants
GET /api/tenants
Authorization: Bearer <token>

# Get specific tenant
GET /api/tenants/:tenantId
Authorization: Bearer <token>
```

### Site Deployment
```bash
# Upload site ZIP
POST /api/uploads/:tenantId
Authorization: Bearer <token>
Content-Type: multipart/form-data
file: <nextjs-site.zip>

# Get build status
GET /api/uploads/:tenantId/builds/:buildId
Authorization: Bearer <token>

# Get build logs
GET /api/uploads/:tenantId/builds/:buildId/logs
Authorization: Bearer <token>
```

## 🏗️ Build Process Flow

1. **Upload**: User uploads Next.js ZIP file
2. **Validation**: File type, size, and structure validation
3. **Security Scan**: Malware detection and static analysis
4. **Build**: 
   - Extract ZIP to isolated container
   - Install dependencies (`npm ci`)
   - Inject tenant configuration
   - Run build (`npm run build`)
   - Export static files (`next export`)
5. **Deploy**:
   - Upload artifacts to S3
   - Update CloudFront pointers
   - Invalidate CDN cache
   - Update DNS if needed
6. **Notification**: Email user about deployment status

## 🔒 Security Features

- **Sandboxed Builds**: Isolated containers with limited network access
- **Malware Scanning**: ClamAV integration for uploaded files
- **Static Analysis**: Detection of suspicious files and executables
- **JWT Authentication**: Secure API access
- **Rate Limiting**: Protection against abuse
- **Audit Logging**: Complete action history
- **Input Validation**: Comprehensive request validation

## 🏢 Multi-Tenant Architecture

Each tenant gets:
- Unique subdomain (tenant-id.myapp.com)
- Isolated S3 directories
- Separate build environments
- Individual configuration and secrets
- Custom domain support (optional)

## 📊 Monitoring & Observability

- **Structured Logging**: JSON logs with correlation IDs
- **Audit Trail**: All user actions logged
- **Build Metrics**: Success rates, build times
- **Error Tracking**: Sentry integration ready
- **Health Checks**: Application and dependency status

## 🔄 Build Queue Management

Uses Redis + Bull for:
- Async build processing
- Job retry logic with exponential backoff
- Concurrent build limiting
- Build status tracking
- Failed job analysis

## 🌍 AWS Infrastructure

### Required AWS Services:
- **S3**: File storage and static hosting
- **CloudFront**: Global CDN
- **Route53**: DNS management
- **ACM**: SSL certificates
- **Secrets Manager**: Tenant configuration
- **IAM**: Access control

### Recommended Setup:
```bash
# S3 Buckets
aws s3 mb s3://myapp-uploads
aws s3 mb s3://myapp-static-sites

# CloudFront Distribution
# (Configure via AWS Console or CDK/Terraform)
```

## 🧪 Testing

```bash
# Run tests
npm test

# Run specific test suite
npm test -- --grep "TenantController"

# Run with coverage
npm test -- --coverage
```

## 🚀 Deployment

### Docker Deployment
```bash
# Build image
docker build -t website-deployment-backend .

# Run container
docker run -p 3000:3000 --env-file .env website-deployment-backend
```

### Production Checklist
- [ ] Set strong JWT secret
- [ ] Configure AWS credentials properly
- [ ] Set up CloudWatch logging
- [ ] Configure error monitoring (Sentry)
- [ ] Set up backup strategy for PostgreSQL
- [ ] Configure Redis persistence
- [ ] Set up SSL certificates
- [ ] Configure rate limiting
- [ ] Set up monitoring alerts

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details

## 🆘 Troubleshooting

### Common Issues:

**Build failures:**
- Check Node.js version compatibility
- Verify package.json exists in ZIP
- Review build logs for specific errors

**AWS Connection Issues:**
- Verify AWS credentials
- Check IAM permissions
- Confirm S3 bucket names and regions

**Database Connection:**
- Verify PostgreSQL is running
- Check connection string format
- Ensure database exists

**Redis Issues:**
- Confirm Redis is running
- Check Redis connection settings
- Verify Redis memory limits

### Support Channels:
- GitHub Issues for bug reports
- Documentation wiki for guides
- Slack/Discord for community support

---

Built with ❤️ for scalable multi-tenant deployments
