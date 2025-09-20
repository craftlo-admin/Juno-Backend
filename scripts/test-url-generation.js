#!/usr/bin/env node

require('dotenv').config();

console.log('🧪 Testing URL Generation Logic');
console.log('='.repeat(40));

console.log('\n📋 Environment Variables:');
console.log(`SHARED_CLOUDFRONT_DOMAIN: ${process.env.SHARED_CLOUDFRONT_DOMAIN}`);
console.log(`CUSTOM_DOMAIN_BASE: ${process.env.CUSTOM_DOMAIN_BASE}`);
console.log(`SHARED_CLOUDFRONT_DISTRIBUTION_ID: ${process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID}`);

const testTenantId = 'himanshus-organization-clql5u68';
console.log(`\n🔍 Testing for tenant: ${testTenantId}`);

// Test DNS-safe conversion
const dnsafeTenantId = testTenantId
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, '-')  // Replace invalid chars with hyphens
  .replace(/^-+|-+$/g, '')      // Remove leading/trailing hyphens
  .replace(/-{2,}/g, '-')       // Replace multiple hyphens with single
  .substring(0, 63);            // DNS label max length is 63 chars

console.log(`\n✅ DNS-safe conversion:`);
console.log(`Original: ${testTenantId}`);
console.log(`DNS-safe: ${dnsafeTenantId}`);

// Test URL generation
const customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
const sharedDomain = process.env.SHARED_CLOUDFRONT_DOMAIN;

const customDomainUrl = `https://${dnsafeTenantId}.${customDomainBase}/`;
const tenantPath = `/tenant-${testTenantId}/`;
const sharedDomainUrl = `https://${sharedDomain}${tenantPath}`;

console.log(`\n🌐 Generated URLs:`);
console.log(`Custom Domain URL: ${customDomainUrl}`);
console.log(`Shared Domain URL: ${sharedDomainUrl}`);

// Test with SharedTenantDistributionService
try {
  const SharedService = require('../src/services/sharedTenantDistributionService');
  const service = new SharedService();
  
  console.log(`\n🔧 Service Test:`);
  console.log(`Service configured: ${service.isConfigured()}`);
  
  const generatedUrl = service.generateDeploymentUrl(testTenantId);
  console.log(`Generated URL from service: ${generatedUrl}`);
  
} catch (error) {
  console.error(`\n❌ Service test failed: ${error.message}`);
}

console.log(`\n✨ Test completed!`);