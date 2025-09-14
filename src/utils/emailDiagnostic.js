const nodemailer = require('nodemailer');
const logger = require('./logger');
const net = require('net');
const dns = require('dns').promises;

/**
 * Multi-tenant Website Builder - Email Diagnostic Tool (FIXED)
 * Following project architecture: Express.js MVC, comprehensive error handling, production-ready
 * Features: SMTP testing, network diagnostics, Hostinger-specific validation
 * 
 * @description Fixed nodemailer method call - createTransport not createTransporter
 */
class EmailDiagnostic {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      provider: 'hostinger',
      tests: [],
      summary: {},
      recommendations: []
    };
  }

  /**
   * Run comprehensive email diagnostics
   */
  async runDiagnostics() {
    console.log('🔍 Starting Email Service Diagnostics (Fixed Version)...\n');
    
    // Test 1: Environment Variables
    await this.testEnvironmentVariables();
    
    // Test 2: Network Connectivity
    await this.testNetworkConnectivity();
    
    // Test 3: DNS Resolution
    await this.testDNSResolution();
    
    // Test 4: SMTP Connection (FIXED)
    await this.testSMTPConnection();
    
    // Test 5: Authentication
    await this.testAuthentication();
    
    // Test 6: Send Test Email
    await this.testSendEmail();
    
    // Generate recommendations
    this.generateRecommendations();
    
    // Display results
    this.displayResults();
    
    return this.results;
  }

  /**
   * Test environment variables
   */
  async testEnvironmentVariables() {
    console.log('📋 Testing Email Environment Variables...');
    
    const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'];
    const envTest = {
      name: 'Environment Variables',
      status: 'passed',
      details: {},
      issues: []
    };

    requiredVars.forEach(varName => {
      const value = process.env[varName];
      const isSet = !!value;
      
      envTest.details[varName] = {
        set: isSet,
        value: varName === 'SMTP_PASSWORD' ? (isSet ? '***configured***' : 'NOT_SET') : value
      };
      
      if (!isSet) {
        envTest.status = 'failed';
        envTest.issues.push(`Missing ${varName}`);
      }
      
      console.log(`   ${varName}: ${isSet ? '✅ SET' : '❌ MISSING'}`);
      if (value && varName !== 'SMTP_PASSWORD') {
        console.log(`     Value: ${value}`);
      }
    });
    
    // Validate Hostinger-specific values
    if (process.env.SMTP_HOST && !process.env.SMTP_HOST.includes('hostinger')) {
      envTest.issues.push('SMTP_HOST should contain "hostinger" for Hostinger SMTP');
      envTest.status = 'warning';
    }
    
    if (process.env.SMTP_PORT && !['25', '465', '587', '2525'].includes(process.env.SMTP_PORT)) {
      envTest.issues.push('SMTP_PORT should be 25, 465, 587, or 2525 for Hostinger');
      envTest.status = 'warning';
    }
    
    this.results.tests.push(envTest);
    console.log(`   Status: ${this.getStatusIcon(envTest.status)} ${envTest.status.toUpperCase()}\n`);
  }

  /**
   * Test network connectivity
   */
  async testNetworkConnectivity() {
    console.log('🌐 Testing Network Connectivity...');
    
    const networkTest = {
      name: 'Network Connectivity',
      status: 'unknown',
      details: {},
      tests: []
    };
    
    // Test internet connectivity
    try {
      console.log('   • Testing internet connectivity...');
      await this.testPortConnectivity('8.8.8.8', 53, 3000);
      networkTest.tests.push({
        test: 'Internet Connectivity',
        status: 'passed'
      });
      console.log('     ✅ Internet connection available');
    } catch (error) {
      networkTest.tests.push({
        test: 'Internet Connectivity',
        status: 'failed',
        error: error.message
      });
      console.log('     ❌ Internet connection failed');
    }
    
    // Test SMTP ports
    const smtpPorts = [25, 465, 587, 2525];
    const smtpHost = process.env.SMTP_HOST || 'smtp.hostinger.com';
    
    for (const port of smtpPorts) {
      try {
        console.log(`   • Testing SMTP port ${port} connectivity to ${smtpHost}...`);
        await this.testPortConnectivity(smtpHost, port, 5000);
        networkTest.tests.push({
          test: `SMTP Port ${port}`,
          status: 'passed'
        });
        console.log(`     ✅ Port ${port} is accessible`);
      } catch (error) {
        networkTest.tests.push({
          test: `SMTP Port ${port}`,
          status: 'failed',
          error: error.message
        });
        console.log(`     ❌ Port ${port} failed: ${error.message}`);
      }
    }
    
    networkTest.status = networkTest.tests.some(t => t.status === 'passed') ? 'passed' : 'failed';
    this.results.tests.push(networkTest);
    console.log('');
  }

  /**
   * Test DNS resolution
   */
  async testDNSResolution() {
    console.log('🔍 Testing DNS Resolution...');
    
    const dnsTest = {
      name: 'DNS Resolution',
      status: 'unknown',
      details: {},
      resolvedIPs: []
    };
    
    const smtpHost = process.env.SMTP_HOST || 'smtp.hostinger.com';
    
    try {
      console.log(`   • Resolving ${smtpHost}...`);
      const addresses = await dns.resolve(smtpHost);
      dnsTest.status = 'passed';
      dnsTest.resolvedIPs = addresses;
      dnsTest.details.resolution = 'successful';
      
      console.log(`     ✅ DNS resolved: ${addresses.join(', ')}`);
    } catch (error) {
      dnsTest.status = 'failed';
      dnsTest.details.error = error.message;
      dnsTest.details.code = error.code;
      
      console.log(`     ❌ DNS resolution failed: ${error.message}`);
    }
    
    this.results.tests.push(dnsTest);
    console.log('');
  }

  /**
   * Test SMTP connection (FIXED - corrected nodemailer method)
   */
  async testSMTPConnection() {
    console.log('🔧 Testing SMTP Connection (Fixed Method)...');
    
    const configs = this.getHostingerSMTPConfigs();
    let hasWorkingConfig = false;
    
    for (const config of configs) {
      console.log(`\n   Testing: ${config.name}`);
      
      const connectionTest = {
        name: `SMTP Connection - ${config.name}`,
        config: config.config,
        status: 'failed',
        details: {},
        timing: {},
        error: null
      };
      
      try {
        const startTime = Date.now();
        
        console.log('     • Creating transporter with nodemailer.createTransport...');
        
        // FIXED: Use createTransport instead of createTransporter
        const transporter = nodemailer.createTransport({
          ...config.config,
          connectionTimeout: 10000,
          greetingTimeout: 5000,
          socketTimeout: 10000,
          debug: false, // Reduce debug output for cleaner logs
          logger: false
        });
        
        console.log('     • Verifying connection...');
        await this.verifyWithTimeout(transporter, 8000);
        
        const endTime = Date.now();
        connectionTest.timing.verification = `${endTime - startTime}ms`;
        connectionTest.status = 'passed';
        connectionTest.details.verification = 'successful';
        hasWorkingConfig = true;
        
        console.log(`     ✅ Connection successful (${connectionTest.timing.verification})`);
        
        // Store working configuration for later tests
        this.workingConfig = config.config;
        
        // Cleanup
        if (typeof transporter.close === 'function') {
          transporter.close();
        }
        
        this.results.tests.push(connectionTest);
        
        // If we have a working config, we can stop testing others
        break;
        
      } catch (error) {
        connectionTest.status = 'failed';
        connectionTest.error = error.message;
        connectionTest.details.errorCode = error.code;
        connectionTest.details.errorCommand = error.command;
        
        console.log(`     ❌ Failed: ${error.message}`);
        if (error.code) {
          console.log(`     📋 Error Code: ${error.code}`);
        }
        
        this.results.tests.push(connectionTest);
      }
    }
    
    if (!hasWorkingConfig) {
      console.log('\n   ⚠️  No working SMTP configuration found');
    }
    
    console.log('');
  }

  /**
   * Test authentication
   */
  async testAuthentication() {
    console.log('🔐 Testing Authentication...');
    
    const authTest = {
      name: 'SMTP Authentication',
      status: 'unknown',
      details: {},
      methods: []
    };
    
    // Test with the working configuration
    if (!this.workingConfig) {
      authTest.status = 'skipped';
      authTest.details.reason = 'No working SMTP connection found';
      console.log('   ⏭️  Skipped - No working SMTP connection');
      this.results.tests.push(authTest);
      console.log('');
      return;
    }
    
    try {
      console.log('   • Testing authentication...');
      
      // FIXED: Use createTransport instead of createTransporter
      const transporter = nodemailer.createTransport({
        ...this.workingConfig,
        connectionTimeout: 8000,
        greetingTimeout: 5000,
        socketTimeout: 8000
      });
      
      await this.verifyWithTimeout(transporter, 6000);
      
      authTest.status = 'passed';
      authTest.methods.push({
        method: 'LOGIN',
        status: 'passed'
      });
      
      console.log(`     ✅ Authentication successful`);
      
      // Cleanup
      if (typeof transporter.close === 'function') {
        transporter.close();
      }
      
    } catch (error) {
      authTest.status = 'failed';
      authTest.methods.push({
        method: 'LOGIN',
        status: 'failed',
        error: error.message,
        code: error.code
      });
      
      console.log(`     ❌ Authentication failed: ${error.message}`);
      
      // Check for specific auth errors
      if (error.code === 'EAUTH' || error.responseCode === 535) {
        console.log('     💡 This appears to be a credentials issue');
      }
    }
    
    this.results.tests.push(authTest);
    console.log('');
  }

  /**
   * Test sending email
   */
  async testSendEmail() {
    console.log('📧 Testing Email Sending...');
    
    const sendTest = {
      name: 'Email Sending',
      status: 'unknown',
      details: {},
      timing: {}
    };
    
    if (!this.workingConfig) {
      sendTest.status = 'skipped';
      sendTest.details.reason = 'No working SMTP connection found';
      console.log('   ⏭️  Skipped - No working SMTP connection');
      this.results.tests.push(sendTest);
      console.log('');
      return;
    }
    
    try {
      console.log('   • Creating transporter for send test...');
      
      // FIXED: Use createTransport instead of createTransporter
      const transporter = nodemailer.createTransport(this.workingConfig);
      
      console.log('   • Sending test email...');
      const startTime = Date.now();
      
      const result = await transporter.sendMail({
        from: `"Website Builder Test" <${process.env.SMTP_USER}>`,
        to: process.env.SMTP_USER,
        subject: `Email Test - ${new Date().toISOString()}`,
        html: `
          <h2>🎉 Email Test Successful!</h2>
          <p>This email confirms that your Hostinger SMTP configuration is working correctly.</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p><strong>From:</strong> ${process.env.SMTP_USER}</p>
          <p><strong>Provider:</strong> Hostinger SMTP</p>
          <p><strong>Configuration:</strong> ${this.workingConfig.host}:${this.workingConfig.port}</p>
          <hr>
          <p><small>This is an automated test email from Website Builder Backend.</small></p>
        `,
        text: `Email Test Successful!\n\nTimestamp: ${new Date().toISOString()}\nFrom: ${process.env.SMTP_USER}\nProvider: Hostinger SMTP\nConfiguration: ${this.workingConfig.host}:${this.workingConfig.port}`
      });
      
      const endTime = Date.now();
      sendTest.timing.sending = `${endTime - startTime}ms`;
      sendTest.status = 'passed';
      sendTest.details.messageId = result.messageId;
      sendTest.details.response = result.response;
      
      console.log(`     ✅ Test email sent successfully (${sendTest.timing.sending})`);
      console.log(`     📧 Message ID: ${result.messageId}`);
      console.log(`     📬 Check your inbox: ${process.env.SMTP_USER}`);
      
      // Cleanup
      if (typeof transporter.close === 'function') {
        transporter.close();
      }
      
    } catch (error) {
      sendTest.status = 'failed';
      sendTest.error = error.message;
      sendTest.details.errorCode = error.code;
      
      console.log(`     ❌ Email sending failed: ${error.message}`);
    }
    
    this.results.tests.push(sendTest);
    console.log('');
  }

  /**
   * Get Hostinger SMTP configurations
   */
  getHostingerSMTPConfigs() {
    const baseAuth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    };

    return [
      {
        name: 'SSL (Port 465) - Recommended',
        config: {
          host: process.env.SMTP_HOST || 'smtp.hostinger.com',
          port: 465,
          secure: true,
          auth: baseAuth,
          tls: {
            rejectUnauthorized: false,
            minVersion: 'TLSv1.2'
          }
        }
      },
      {
        name: 'STARTTLS (Port 587)',
        config: {
          host: process.env.SMTP_HOST || 'smtp.hostinger.com',
          port: 587,
          secure: false,
          requireTLS: true,
          auth: baseAuth,
          tls: {
            rejectUnauthorized: false
          }
        }
      },
      {
        name: 'Alternative (Port 2525)',
        config: {
          host: process.env.SMTP_HOST || 'smtp.hostinger.com',
          port: 2525,
          secure: false,
          auth: baseAuth,
          tls: {
            rejectUnauthorized: false
          }
        }
      }
    ];
  }

  /**
   * Verify transporter with timeout
   */
  async verifyWithTimeout(transporter, timeout = 8000) {
    return Promise.race([
      transporter.verify(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Verification timeout')), timeout)
      )
    ]);
  }

  /**
   * Test port connectivity
   */
  async testPortConnectivity(host, port, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, timeout);
      
      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve();
      });
      
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /**
   * Generate recommendations based on test results
   */
  generateRecommendations() {
    const recommendations = [];
    
    // Check for missing environment variables
    const envTest = this.results.tests.find(t => t.name === 'Environment Variables');
    if (envTest && envTest.status === 'failed') {
      recommendations.push({
        priority: 'high',
        category: 'configuration',
        issue: 'Missing email environment variables',
        solution: 'Set all required SMTP environment variables in your .env file',
        details: envTest.issues,
        action: 'Update .env file with correct Hostinger SMTP settings'
      });
    }
    
    // Check for network connectivity issues
    const networkTest = this.results.tests.find(t => t.name === 'Network Connectivity');
    if (networkTest && networkTest.status === 'failed') {
      const failedPorts = networkTest.tests.filter(t => t.status === 'failed');
      
      if (failedPorts.length === networkTest.tests.length) {
        recommendations.push({
          priority: 'high',
          category: 'network',
          issue: 'All SMTP ports blocked',
          solution: 'Your ISP or firewall is blocking SMTP connections',
          details: [
            'Contact your ISP about SMTP port blocking',
            'Try using port 2525 (often unblocked)',
            'Use a VPN to test from different network',
            'Check Windows Firewall settings'
          ],
          action: 'Contact ISP or try alternative network'
        });
      }
    }
    
    // Check for authentication issues
    const authTest = this.results.tests.find(t => t.name === 'SMTP Authentication');
    if (authTest && authTest.status === 'failed') {
      recommendations.push({
        priority: 'high',
        category: 'authentication',
        issue: 'SMTP authentication failed',
        solution: 'Your email credentials are incorrect',
        details: [
          'Verify SMTP_USER is your full email address',
          'Check SMTP_PASSWORD is correct',
          'Ensure email account exists and is active',
          'Check if email account has SMTP enabled',
          'Try logging into webmail to verify credentials'
        ],
        action: 'Verify and update email credentials in .env file'
      });
    }
    
    // Success recommendations
    const successfulTests = this.results.tests.filter(t => t.status === 'passed');
    if (successfulTests.length === this.results.tests.length) {
      recommendations.push({
        priority: 'low',
        category: 'success',
        issue: 'All tests passed',
        solution: 'Your email configuration is working perfectly',
        details: [
          'SMTP connection established successfully',
          'Authentication working correctly',
          'Test email sent successfully',
          'Ready for production use'
        ],
        action: 'Email service is ready - no action needed'
      });
    }
    
    this.results.recommendations = recommendations;
  }

  /**
   * Display comprehensive results
   */
  displayResults() {
    console.log('\n📊 EMAIL DIAGNOSTIC RESULTS (FIXED VERSION)');
    console.log('═'.repeat(50));
    
    // Summary
    const totalTests = this.results.tests.length;
    const passedTests = this.results.tests.filter(t => t.status === 'passed').length;
    const failedTests = this.results.tests.filter(t => t.status === 'failed').length;
    const skippedTests = this.results.tests.filter(t => t.status === 'skipped').length;
    
    console.log(`\n📈 Summary:`);
    console.log(`   Total Tests: ${totalTests}`);
    console.log(`   ✅ Passed: ${passedTests}`);
    console.log(`   ❌ Failed: ${failedTests}`);
    console.log(`   ⏭️  Skipped: ${skippedTests}`);
    console.log(`   Overall: ${failedTests === 0 ? '✅ SUCCESS' : '❌ ISSUES FOUND'}`);
    
    // Detailed results
    console.log(`\n📋 Detailed Results:`);
    this.results.tests.forEach(test => {
      console.log(`\n   ${this.getStatusIcon(test.status)} ${test.name}: ${test.status.toUpperCase()}`);
      
      if (test.error) {
        console.log(`     Error: ${test.error}`);
      }
      
      if (test.issues && test.issues.length > 0) {
        console.log(`     Issues: ${test.issues.join(', ')}`);
      }
      
      if (test.timing) {
        Object.entries(test.timing).forEach(([key, value]) => {
          console.log(`     ${key}: ${value}`);
        });
      }
      
      if (test.details && test.details.messageId) {
        console.log(`     📧 Message ID: ${test.details.messageId}`);
      }
    });
    
    // Recommendations
    if (this.results.recommendations.length > 0) {
      console.log(`\n🔧 RECOMMENDATIONS`);
      console.log('═'.repeat(50));
      
      this.results.recommendations.forEach((rec, index) => {
        console.log(`\n${index + 1}. ${rec.issue} (${rec.priority.toUpperCase()} PRIORITY)`);
        console.log(`   Category: ${rec.category}`);
        console.log(`   Solution: ${rec.solution}`);
        console.log(`   Action: ${rec.action}`);
        if (rec.details && Array.isArray(rec.details)) {
          rec.details.forEach(detail => {
            console.log(`   • ${detail}`);
          });
        }
      });
    }
    
    console.log(`\n🏁 Diagnostic completed at ${this.results.timestamp}`);
    console.log('🔧 Fixed: nodemailer.createTransport method corrected');
    console.log('');
  }

  /**
   * Get status icon
   */
  getStatusIcon(status) {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'warning': return '⚠️';
      case 'skipped': return '⏭️';
      default: return '❓';
    }
  }
}

/**
 * Quick email test function (FIXED)
 */
async function quickEmailTest() {
  console.log('⚡ Quick Email Test (Fixed Version)...\n');
  
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.log('❌ Missing environment variables:', missing.join(', '));
    console.log('💡 Run full diagnostics: npm run test:email');
    return false;
  }
  
  try {
    // FIXED: Use createTransport instead of createTransporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });

    await transporter.verify();
    console.log('✅ Quick email test: SMTP connection successful');
    return true;
    
  } catch (error) {
    console.log('❌ Quick email test failed:', error.message);
    console.log('💡 Run full diagnostics: npm run test:email');
    return false;
  }
}

/**
 * Run full diagnostics
 */
async function runEmailDiagnostics() {
  const diagnostic = new EmailDiagnostic();
  return await diagnostic.runDiagnostics();
}

module.exports = {
  runEmailDiagnostics,
  quickEmailTest,
  EmailDiagnostic
};

// Allow running diagnostics directly
if (require.main === module) {
  require('dotenv').config();
  
  console.log('🚀 Website Builder - Email Diagnostic Tool (FIXED)');
  console.log('═'.repeat(50));
  console.log('🔧 Fixed: nodemailer.createTransport method corrected\n');
  
  runEmailDiagnostics().then((results) => {
    const failedTests = results.tests.filter(t => t.status === 'failed').length;
    
    if (failedTests === 0) {
      console.log('\n🎉 Email service is working perfectly!');
      console.log('📧 Real emails will be delivered successfully');
      process.exit(0);
    } else {
      console.log('\n🔧 Email service needs attention. Check recommendations above.');
      process.exit(1);
    }
  }).catch(error => {
    console.error('❌ Diagnostic tool error:', error);
    process.exit(1);
  });
}