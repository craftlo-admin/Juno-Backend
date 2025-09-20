#!/usr/bin/env node

require('dotenv').config();

console.log('⏳ Waiting for CloudFront Function propagation...');
console.log('   The CloudFront Function was just updated and needs time to propagate.');
console.log('   This typically takes 2-3 minutes.\n');

console.log('🧪 Test URLs:');
console.log('   Custom Domain: https://himanshus-organization-clql5u68.junotech.in/');
console.log('   Direct Access: https://d10cnaov0pnymw.cloudfront.net/tenant-himanshus-organization-clql5u68/');
console.log('');

console.log('📋 What should happen:');
console.log('1. CloudFront receives request');
console.log('2. Function extracts tenant ID from hostname/path');
console.log('3. Function rewrites to: /tenants/himanshus-organization-clql5u68/deployments/current/index.html');
console.log('4. S3 serves the file (which we confirmed exists)');
console.log('5. User sees the website instead of 503 error');
console.log('');

console.log('⚠️  If you still get 503 errors:');
console.log('   - Wait another 2-3 minutes (CloudFront can be slow)');
console.log('   - Try a hard refresh (Ctrl+F5)');
console.log('   - Check that you have the latest deployment');
console.log('');

console.log('✅ Next steps:');
console.log('   1. Wait 3 minutes');
console.log('   2. Test: https://himanshus-organization-clql5u68.junotech.in/');
console.log('   3. If working, test other tenant deployments');
console.log('   4. If still 503, run: npm run cloudfront:test');

// Show current time for reference
const now = new Date();
const testTime = new Date(now.getTime() + 3 * 60 * 1000); // 3 minutes from now

console.log(`\n🕒 Current time: ${now.toISOString()}`);
console.log(`🎯 Test again at: ${testTime.toISOString()}`);
console.log('');

// Set a timer reminder (though the script will exit)
console.log('💡 Pro tip: Run this command in 3 minutes to verify:');
console.log('   curl -I https://himanshus-organization-clql5u68.junotech.in/');
console.log('   (Should return 200 OK instead of 503)');