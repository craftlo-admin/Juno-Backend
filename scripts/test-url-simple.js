#!/usr/bin/env node

require('dotenv').config();

console.log('🧪 Testing URL Generation Logic (No DB)');
console.log('='.repeat(45));

console.log('\n📋 Environment Variables:');
console.log(`SHARED_CLOUDFRONT_DOMAIN: ${process.env.SHARED_CLOUDFRONT_DOMAIN}`);
console.log(`CUSTOM_DOMAIN_BASE: ${process.env.CUSTOM_DOMAIN_BASE}`);
console.log(`SHARED_CLOUDFRONT_DISTRIBUTION_ID: ${process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID}`);

const testTenantId = 'himanshus-organization-clql5u68';
console.log(`\n🔍 Testing for tenant: ${testTenantId}`);

// Test DNS-safe conversion (same logic as in service)
function makeDNSSafe(tenantId) {
  return tenantId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')  // Replace invalid chars with hyphens
    .replace(/^-+|-+$/g, '')      // Remove leading/trailing hyphens
    .replace(/-{2,}/g, '-')       // Replace multiple hyphens with single
    .substring(0, 63);            // DNS label max length is 63 chars
}

const dnsafeTenantId = makeDNSSafe(testTenantId);

console.log(`\n✅ DNS-safe conversion:`);
console.log(`Original: ${testTenantId}`);
console.log(`DNS-safe: ${dnsafeTenantId}`);

// Test URL generation (same logic as in service)
const customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
const sharedDomain = process.env.SHARED_CLOUDFRONT_DOMAIN;

const customDomainUrl = `https://${dnsafeTenantId}.${customDomainBase}/`;
const tenantPath = `/tenant-${testTenantId}/`;
const sharedDomainUrl = `https://${sharedDomain}${tenantPath}`;

console.log(`\n🌐 Generated URLs:`);
console.log(`Custom Domain URL: ${customDomainUrl}`);
console.log(`Shared Domain URL: ${sharedDomainUrl}`);

// Test what deploymentService would receive
const mockTenantDomainResponse = {
  customDomain: `${dnsafeTenantId}.${customDomainBase}`,
  distributionId: process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID,
  cloudFrontDomain: sharedDomain,
  tenantDomain: `${dnsafeTenantId}.${customDomainBase}`,  // This is what deploymentService uses
  deploymentUrl: customDomainUrl,
  alternativeUrl: sharedDomainUrl,
  tenantPath: tenantPath,
  setupType: 'shared_distribution',
  isSharedDistribution: true
};

console.log(`\n🔧 Mock Service Response:`);
console.log(`tenantDomain: ${mockTenantDomainResponse.tenantDomain}`);
console.log(`deploymentUrl: ${mockTenantDomainResponse.deploymentUrl}`);

// Test what deploymentService.js would generate
const deploymentServiceUrl = `https://${mockTenantDomainResponse.tenantDomain}`;

console.log(`\n📤 What deploymentService.js would return:`);
console.log(`Final URL: ${deploymentServiceUrl}`);

// Check if the problem is undefined values
console.log(`\n🔍 Debugging undefined issue:`);
console.log(`tenantDomain undefined? ${mockTenantDomainResponse.tenantDomain === undefined}`);
console.log(`customDomainBase undefined? ${customDomainBase === undefined}`);
console.log(`dnsafeTenantId undefined? ${dnsafeTenantId === undefined}`);

if (deploymentServiceUrl.includes('undefined')) {
  console.log(`\n❌ FOUND UNDEFINED IN URL!`);
  console.log(`The issue is in the URL construction logic.`);
} else {
  console.log(`\n✅ URLs look good - no undefined values!`);
  console.log(`The issue might be in the database response or service instantiation.`);
}

console.log(`\n✨ Test completed!`);