// Test the actual CloudFront URLs with correct paths
const https = require('https');

async function testUrls() {
    console.log('🌐 Testing CloudFront URLs\n');
    
    const baseUrl = 'https://d2hvyig9aqs577.cloudfront.net/tenants/himanshubarnwal26_gmail_com-35aebtgz/deployments/70c6f5ec-a92e-4638-87ad-349f8ffd93d3';
    
    const urlsToTest = [
        `${baseUrl}/`,
        `${baseUrl}/index.html`,
        `${baseUrl}/server/app/index.html`,
        `${baseUrl}/server/app/`,
        `${baseUrl}/server/app/about.html`,
        `${baseUrl}/server/app/projects.html`
    ];
    
    for (const url of urlsToTest) {
        await testUrl(url);
    }
}

function testUrl(url) {
    return new Promise((resolve) => {
        console.log(`\n🔗 Testing: ${url}`);
        
        const req = https.get(url, (res) => {
            console.log(`   Status: ${res.statusCode}`);
            console.log(`   Content-Type: ${res.headers['content-type']}`);
            console.log(`   Cache: ${res.headers['x-cache'] || 'N/A'}`);
            
            if (res.statusCode === 200) {
                console.log('   ✅ SUCCESS!');
            } else if (res.statusCode === 307 || res.statusCode === 301) {
                console.log(`   ➡️ Redirect to: ${res.headers.location}`);
            } else {
                console.log(`   ❌ Failed`);
            }
            
            res.on('data', () => {}); // Consume response
            res.on('end', resolve);
        });
        
        req.on('error', (err) => {
            console.log(`   ❌ Error: ${err.message}`);
            resolve();
        });
        
        req.setTimeout(5000, () => {
            console.log('   ⏰ Timeout');
            req.abort();
            resolve();
        });
    });
}

testUrls();