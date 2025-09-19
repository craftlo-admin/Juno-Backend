# 🚀 Automated Multi-Tenant DNS Setup with Route 53

## Overview
This guide sets up fully automated DNS management for your multi-tenant architecture using AWS Route 53, eliminating manual DNS record creation.

## 🎯 Architecture
```
New Tenant Created → API Call → Route 53 DNS Record → CloudFront Distribution → *.junotech.in
```

## Step 1: Migrate DNS to Route 53

### 1.1 Create Route 53 Hosted Zone
```bash
aws route53 create-hosted-zone \
  --name junotech.in \
  --caller-reference $(date +%s) \
  --hosted-zone-config Comment="Multi-tenant website builder DNS"
```

### 1.2 Update Hostinger Nameservers
1. Go to Hostinger Domain Management
2. Find "Nameservers" section  
3. Change from Hostinger nameservers to Route 53:
   ```
   ns-123.awsdns-12.com
   ns-456.awsdns-45.net
   ns-789.awsdns-78.co.uk
   ns-012.awsdns-01.org
   ```

### 1.3 Migrate Existing Records
Add these records to Route 53:
```bash
# Main domain (keep your current hosting)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "junotech.in",
        "Type": "A", 
        "TTL": 300,
        "ResourceRecords": [{"Value": "84.32.84.32"}]
      }
    }]
  }'

# WWW subdomain
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE", 
      "ResourceRecordSet": {
        "Name": "www.junotech.in",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "junotech.in"}]
      }
    }]
  }'
```

## Step 2: Automated SSL Certificate

### 2.1 Request Certificate with Route 53 Validation
```bash
aws acm request-certificate \
  --domain-name "*.junotech.in" \
  --subject-alternative-names "junotech.in" \
  --validation-method DNS \
  --region us-east-1
```

### 2.2 Auto-Add Validation Records
Route 53 can automatically add validation records:
```bash
# Get certificate details
CERT_ARN=$(aws acm list-certificates --region us-east-1 --query 'CertificateSummaryList[?DomainName==`*.junotech.in`].CertificateArn' --output text)

# Get validation records
aws acm describe-certificate \
  --certificate-arn $CERT_ARN \
  --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
```

## Step 3: Automated DNS Service

### 3.1 Create DNS Management Service
```javascript
// src/services/dnsService.js
const AWS = require('aws-sdk');
const route53 = new AWS.Route53();

class DNSService {
  constructor() {
    this.hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
    this.domain = process.env.CUSTOM_DOMAIN_BASE; // junotech.in
  }

  async createTenantDNSRecord(tenantId, cloudfrontDomain) {
    const subdomain = `${tenantId}.${this.domain}`;
    
    const params = {
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
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

    try {
      const result = await route53.changeResourceRecordSets(params).promise();
      console.log(`✅ DNS record created: ${subdomain} → ${cloudfrontDomain}`);
      return result.ChangeInfo.Id;
    } catch (error) {
      console.error(`❌ DNS record creation failed:`, error);
      throw error;
    }
  }

  async deleteTenantDNSRecord(tenantId, cloudfrontDomain) {
    const subdomain = `${tenantId}.${this.domain}`;
    
    const params = {
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Changes: [{
          Action: 'DELETE',
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

    try {
      const result = await route53.changeResourceRecordSets(params).promise();
      console.log(`✅ DNS record deleted: ${subdomain}`);
      return result.ChangeInfo.Id;
    } catch (error) {
      console.error(`❌ DNS record deletion failed:`, error);
      throw error;
    }
  }

  async checkDNSPropagation(subdomain) {
    try {
      const dns = require('dns').promises;
      const result = await dns.resolveCname(subdomain);
      return result.length > 0;
    } catch (error) {
      return false;
    }
  }
}

module.exports = DNSService;
```

### 3.2 Update Tenant Distribution Service
```javascript
// Update src/services/tenantDistributionService.js
const DNSService = require('./dnsService');

class TenantDistributionService {
  static async createTenantDistribution(tenantId) {
    try {
      // ... existing CloudFront creation code ...
      
      const distribution = result.Distribution;
      const distributionDomain = distribution.DomainName;
      const customSubdomain = this.generateTenantSubdomain(tenantId);
      
      // Automatically create DNS record
      if (customSubdomain && process.env.ROUTE53_HOSTED_ZONE_ID) {
        const dnsService = new DNSService();
        await dnsService.createTenantDNSRecord(tenantId, distributionDomain);
        
        logger.info('DNS record created automatically', {
          tenantId,
          subdomain: customSubdomain,
          cloudfrontDomain: distributionDomain
        });
      }
      
      // ... rest of existing code ...
    } catch (error) {
      // ... error handling ...
    }
  }
}
```

## Step 4: Environment Configuration

### 4.1 Update .env
```env
# Route 53 Configuration
ROUTE53_HOSTED_ZONE_ID=Z123456789ABCDEF
ROUTE53_ENABLED=true

# Custom Domain Configuration  
CUSTOM_DOMAIN_ENABLED=true
CUSTOM_DOMAIN_BASE=junotech.in

# SSL Certificate (will be auto-validated)
SSL_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id
```

### 4.2 AWS Permissions
Add to your IAM user/role:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets",
        "route53:GetChange",
        "route53:ListHostedZones",
        "route53:ListResourceRecordSets"
      ],
      "Resource": "*"
    }
  ]
}
```

## 🎯 Complete Automation Flow

### When New Tenant is Created:
1. **API Call** → Create tenant
2. **CloudFront** → Distribution created automatically  
3. **Route 53** → DNS record added automatically
4. **Result** → `https://tenant123.junotech.in` works immediately

### Code Example:
```javascript
// Tenant creation now includes DNS automation
const tenantResult = await TenantDistributionService.createTenantDistribution(tenantId);
// DNS record is automatically created
// No manual intervention needed!
```

## 💰 Cost Analysis

### Route 53 Costs:
- **Hosted Zone**: $0.50/month
- **DNS Queries**: $0.40 per million queries
- **Total for 1000 tenants**: ~$1-2/month

### Benefits:
- ✅ **Zero manual work** for new tenants
- ✅ **Instant DNS propagation** (30 seconds)
- ✅ **Automatic SSL** certificate validation
- ✅ **Scalable to millions** of tenants

## 🚀 Migration Steps

### Today:
1. Create Route 53 hosted zone
2. Update Hostinger nameservers
3. Request SSL certificate with DNS validation

### This Week:
4. Implement DNS service
5. Update tenant distribution service
6. Test automated tenant creation

### Result:
- New tenants get `tenant123.junotech.in` automatically
- No manual DNS work ever again
- Professional, scalable multi-tenant architecture

## Ready to Automate?

This setup eliminates all manual work and makes your multi-tenant system truly scalable!