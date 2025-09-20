#!/usr/bin/env node

require('dotenv').config();

// Simulate the CloudFront Function logic
function simulateCloudfrontFunction() {
  console.log('🧪 Simulating CloudFront Function Logic');
  console.log('='.repeat(45));

  // Test case 1: Custom domain
  const testHost1 = 'himanshus-organization-clql5u68.junotech.in';
  const testUri1 = '/index.html';

  console.log(`\n📋 Test Case 1: Custom Domain`);
  console.log(`   Host: ${testHost1}`);
  console.log(`   URI: ${testUri1}`);

  const customDomainBase = 'junotech.in';
  let tenantId = null;

  if (testHost1.endsWith('.' + customDomainBase)) {
    const subdomain = testHost1.replace('.' + customDomainBase, '');
    console.log(`   Extracted subdomain: ${subdomain}`);
    
    // Check validation logic
    const isValid = subdomain && 
      subdomain !== 'www' && 
      subdomain !== 'api' && 
      subdomain !== 'admin' && 
      subdomain !== 'cdn' &&
      subdomain !== 'mail' &&
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain) && 
      subdomain.length >= 3 && 
      subdomain.length <= 63;
    
    console.log(`   Validation checks:`);
    console.log(`     - Not reserved: ${subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'admin'}`);
    console.log(`     - Valid format: ${/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain)}`);
    console.log(`     - Length (3-63): ${subdomain.length >= 3 && subdomain.length <= 63} (${subdomain.length})`);
    console.log(`     - Overall valid: ${isValid}`);
    
    if (isValid) {
      tenantId = subdomain;
    }
  }

  if (tenantId) {
    let uri = testUri1;
    if (uri === '' || uri === '/') {
      uri = '/index.html';
    }
    if (!uri.startsWith('/')) {
      uri = '/' + uri;
    }
    
    const newUri = '/tenants/' + tenantId + '/deployments/current' + uri;
    console.log(`   ✅ Rewrite successful:`);
    console.log(`      Original: ${testHost1}${testUri1}`);
    console.log(`      S3 Path:  ${newUri}`);
  } else {
    console.log(`   ❌ Tenant ID extraction failed`);
  }

  // Test case 2: Direct CloudFront access
  console.log(`\n📋 Test Case 2: Direct CloudFront Access`);
  const testHost2 = 'd10cnaov0pnymw.cloudfront.net';
  const testUri2 = '/tenant-himanshus-organization-clql5u68/index.html';

  console.log(`   Host: ${testHost2}`);
  console.log(`   URI: ${testUri2}`);

  let tenantId2 = null;
  let uri2 = testUri2;

  if (testHost2.includes('.cloudfront.net')) {
    const pathMatch = testUri2.match(/^\/tenant-([a-zA-Z0-9-]+)(\/.*)?$/);
    console.log(`   Path match result: ${pathMatch}`);
    
    if (pathMatch) {
      tenantId2 = pathMatch[1];
      uri2 = pathMatch[2] || '/';
      console.log(`   Extracted tenant: ${tenantId2}`);
      console.log(`   Remaining path: ${uri2}`);
    }
  }

  if (tenantId2) {
    if (uri2 === '' || uri2 === '/') {
      uri2 = '/index.html';
    }
    if (!uri2.startsWith('/')) {
      uri2 = '/' + uri2;
    }
    
    const newUri2 = '/tenants/' + tenantId2 + '/deployments/current' + uri2;
    console.log(`   ✅ Rewrite successful:`);
    console.log(`      Original: ${testHost2}${testUri2}`);
    console.log(`      S3 Path:  ${newUri2}`);
  } else {
    console.log(`   ❌ Tenant ID extraction failed`);
  }

  console.log(`\n✨ Function simulation complete!`);
}

simulateCloudfrontFunction();