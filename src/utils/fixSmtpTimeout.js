const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Quick SMTP timeout diagnostic and fix tool
 */
async function fixSmtpTimeout() {
  console.log('🔧 SMTP Timeout Fix Tool\n');
  
  const configs = [
    {
      name: 'Port 2525 (ISP-Friendly)',
      port: 2525,
      secure: false,
      timeouts: { connection: 5000, greeting: 3000, socket: 5000 }
    },
    {
      name: 'Port 587 (STARTTLS)',
      port: 587,
      secure: false,
      requireTLS: true,
      timeouts: { connection: 6000, greeting: 4000, socket: 6000 }
    },
    {
      name: 'Port 465 (SSL - Short Timeout)',
      port: 465,
      secure: true,
      timeouts: { connection: 4000, greeting: 3000, socket: 4000 }
    }
  ];
  
  for (const config of configs) {
    console.log(`\n🧪 Testing: ${config.name}`);
    
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.hostinger.com',
        port: config.port,
        secure: config.secure,
        requireTLS: config.requireTLS,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        },
        connectionTimeout: config.timeouts.connection,
        greetingTimeout: config.timeouts.greeting,
        socketTimeout: config.timeouts.socket,
        tls: {
          rejectUnauthorized: false
        }
      });
      
      const startTime = Date.now();
      await transporter.verify();
      const duration = Date.now() - startTime;
      
      console.log(`   ✅ SUCCESS in ${duration}ms`);
      console.log(`   📋 Working configuration found:`);
      console.log(`      SMTP_PORT=${config.port}`);
      console.log(`      Timeouts: ${JSON.stringify(config.timeouts)}`);
      console.log(`\n🎉 Update your .env file with SMTP_PORT=${config.port}`);
      
      transporter.close();
      return;
      
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
    }
  }
  
  console.log('\n❌ All configurations failed. Possible issues:');
  console.log('   • ISP blocking SMTP ports');
  console.log('   • Firewall/Antivirus interference');
  console.log('   • Incorrect credentials');
  console.log('   • Network connectivity issues');
  console.log('\n💡 Try running from mobile hotspot to test ISP blocking');
}

// Run if called directly
if (require.main === module) {
  fixSmtpTimeout().catch(console.error);
}

module.exports = { fixSmtpTimeout };