const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

/**
 * Multi-tenant Website Builder - Enhanced Email Service (FIXED)
 * Following project architecture: Express.js MVC, comprehensive error handling, production-ready
 * Features: Progressive timeout handling, connection pooling, Hostinger optimization
 * 
 * @class EmailService
 * @description Singleton email service optimized for Hostinger SMTP with robust error handling
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.lastError = null;
    this.connectionAttempts = 0;
    this.maxRetries = 3;
    this.mode = 'unknown';
    this.workingConfig = null;
    
    // Advanced timeout configuration
    this.timeoutConfig = {
      connection: 8000,      
      greeting: 5000,         
      socket: 8000,          
      verification: 6000     
    };
    
    // Initialize immediately but don't block startup
    this.initializeAsync();
  }

  /**
   * Asynchronous initialization with enhanced error recovery
   */
  async initializeAsync() {
    try {
      logger.info('🚀 Starting email service initialization...');
      await this.initialize();
    } catch (error) {
      logger.error('Email service async initialization failed:', error);
      this.createMockTransporter();
    }
  }

  /**
   * Initialize email transporter with progressive timeout handling
   */
  async initialize() {
    logger.info('🔍 Initializing Hostinger SMTP with enhanced timeout handling...');
    
    try {
      // Validate Hostinger configuration with proper error handling
      const emailConfig = this.validateEmailConfig();
      if (!emailConfig.isValid) {
        logger.warn('Hostinger SMTP configuration incomplete:', emailConfig.missing);
        this.createMockTransporter();
        return;
      }

      // Initialize Hostinger SMTP with progressive timeout strategy
      await this.initializeHostingerSMTPWithProgressiveTimeouts();
    } catch (error) {
      logger.error('Email service initialization failed:', error);
      this.createMockTransporter();
    }
  }

  /**
   * Validate Hostinger email configuration with enhanced checks and proper null handling
   */
  validateEmailConfig() {
    const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'];
    const missing = requiredVars.filter(varName => {
      const value = process.env[varName];
      return !value || value.trim() === '';
    });
    
    // Enhanced Hostinger-specific validation with null safety
    const warnings = [];
    
    // SMTP_HOST validation with null check
    const smtpHost = process.env.SMTP_HOST;
    if (smtpHost && typeof smtpHost === 'string') {
      if (!smtpHost.toLowerCase().includes('hostinger')) {
        warnings.push('SMTP_HOST should be smtp.hostinger.com for Hostinger hosting');
      }
      
      // Check for common typos
      const commonTypos = ['hostingr', 'hostiger', 'hostiner'];
      if (commonTypos.some(typo => smtpHost.toLowerCase().includes(typo))) {
        warnings.push('Possible typo in SMTP_HOST - should be smtp.hostinger.com');
      }
    } else if (smtpHost === undefined || smtpHost === null) {
      logger.warn('SMTP_HOST is undefined or null');
    }
    
    // SMTP_PORT validation with proper conversion
    const smtpPort = process.env.SMTP_PORT;
    if (smtpPort && typeof smtpPort === 'string') {
      const port = parseInt(smtpPort, 10);
      if (isNaN(port) || ![25, 465, 587, 2525].includes(port)) {
        warnings.push('SMTP_PORT should be 465 (SSL), 587 (STARTTLS), or 2525 (alternative) for Hostinger');
      }
    }
    
    // SMTP_USER validation with null check
    const smtpUser = process.env.SMTP_USER;
    if (smtpUser && typeof smtpUser === 'string') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(smtpUser)) {
        warnings.push('SMTP_USER should be a valid email address');
      }
    }

    if (warnings.length > 0) {
      logger.warn('Hostinger configuration warnings:', warnings);
    }
    
    return {
      isValid: missing.length === 0,
      missing,
      warnings,
      config: {
        SMTP_HOST: smtpHost || 'undefined',
        SMTP_PORT: smtpPort || 'undefined',
        SMTP_USER: smtpUser || 'undefined',
        SMTP_PASSWORD: process.env.SMTP_PASSWORD ? '***configured***' : 'undefined'
      }
    };
  }

  /**
   * Initialize Hostinger SMTP with progressive timeout strategy (FIXED)
   */
  async initializeHostingerSMTPWithProgressiveTimeouts() {
    logger.info('📧 Setting up Hostinger SMTP with progressive timeout handling...');
    
    try {
      const smtpConfigs = this.getOptimizedHostingerSMTPConfigurations();
      
      for (const config of smtpConfigs) {
        try {
          this.connectionAttempts++;
          logger.info(`🔄 Attempting: ${config.name} (attempt ${this.connectionAttempts})`);
          logger.info(`   Timeouts: conn=${config.timeouts.connection}ms, greet=${config.timeouts.greeting}ms, verify=${config.timeouts.verification}ms`);
          
          // Test configuration with specific timeouts
          const testResult = await this.testSMTPConfigurationWithProgressiveTimeouts(config);
          
          if (testResult.success) {
            this.transporter = config.transporter;
            this.isConfigured = true;
            this.mode = 'hostinger';
            this.workingConfig = config.config;
            
            logger.info(`✅ Hostinger SMTP configured successfully with ${config.name}`, {
              host: config.config.host,
              port: config.config.port,
              secure: config.config.secure,
              user: config.config.auth ? config.config.auth.user : 'undefined',
              verificationTime: testResult.verificationTime,
              connectionTime: testResult.connectionTime
            });
            
            return; // Success - exit retry loop
          }
          
        } catch (error) {
          logger.warn(`❌ ${config.name} failed:`, {
            error: error.message,
            code: error.code,
            command: error.command,
            timeout: error.message && error.message.includes('timeout')
          });
          
          this.lastError = error;
          
          // Cleanup failed transporter
          if (config.transporter && typeof config.transporter.close === 'function') {
            try {
              config.transporter.close();
            } catch (closeError) {
              logger.debug('Error closing failed transporter:', closeError.message);
            }
          }
          
          continue;
        }
      }

      // All Hostinger configurations failed
      logger.error('All Hostinger SMTP configurations failed. Using mock transporter.');
      this.createMockTransporter();
    } catch (error) {
      logger.error('Error in initializeHostingerSMTPWithProgressiveTimeouts:', error);
      this.createMockTransporter();
    }
  }

  /**
   * Get optimized Hostinger SMTP configurations with proper null handling
   */
  getOptimizedHostingerSMTPConfigurations() {
    // Safely get environment variables with fallbacks
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    const smtpHost = process.env.SMTP_HOST || 'smtp.hostinger.com';

    // Validate required auth credentials
    if (!smtpUser || !smtpPassword) {
      logger.error('Missing SMTP credentials:', {
        hasUser: !!smtpUser,
        hasPassword: !!smtpPassword
      });
      throw new Error('SMTP_USER and SMTP_PASSWORD are required for email configuration');
    }

    const baseAuth = {
      user: smtpUser,
      pass: smtpPassword
    };

    // Progressive timeout strategy: start with shorter timeouts, increase if needed
    const timeoutSets = [
      { connection: 6000, greeting: 4000, socket: 6000, verification: 5000 },  // Fast attempt
      { connection: 8000, greeting: 5000, socket: 8000, verification: 6000 },  // Standard
      { connection: 12000, greeting: 8000, socket: 12000, verification: 10000 } // Slow network
    ];

    const configurations = [];

    // Generate configurations for each timeout set
    timeoutSets.forEach((timeouts, index) => {
      const timeoutSuffix = index === 0 ? ' (Fast)' : index === 1 ? ' (Standard)' : ' (Slow Network)';
      
      configurations.push(
        // SSL Port 465 - Most reliable for Hostinger
        {
          name: `Hostinger SSL (Port 465)${timeoutSuffix}`,
          priority: 1,
          timeouts,
          config: {
            host: smtpHost,
            port: 465,
            secure: true,
            auth: baseAuth,
            pool: false, // Disable connection pooling for initial test
            maxConnections: 1,
            maxMessages: 100,
            rateDelta: 1000,
            rateLimit: 5,
            tls: {
              rejectUnauthorized: false,
              minVersion: 'TLSv1.2',
              ciphers: 'HIGH:!aNULL:!MD5',
              // FIX: Added secureProtocol to enforce a specific, reliable TLS version
              secureProtocol: 'TLSv1_2_method' 
            }
          }
        },
        
        // STARTTLS Port 587 - Alternative
        {
          name: `Hostinger STARTTLS (Port 587)${timeoutSuffix}`,
          priority: 2,
          timeouts,
          config: {
            host: smtpHost,
            port: 587,
            secure: false,
            requireTLS: true,
            auth: baseAuth,
            pool: false,
            maxConnections: 1,
            tls: {
              rejectUnauthorized: false,
              // FIX: Added ciphers to improve compatibility
              ciphers: 'HIGH:!aNULL:!MD5',
              starttls: true,
              minVersion: 'TLSv1.2'
            }
          }
        },
        
        // Port 2525 - ISP-friendly alternative
        {
          name: `Hostinger Alternative (Port 2525)${timeoutSuffix}`,
          priority: 3,
          timeouts,
          config: {
            host: smtpHost,
            port: 2525,
            secure: false,
            auth: baseAuth,
            pool: false,
            maxConnections: 1,
            tls: {
              rejectUnauthorized: false
            }
          }
        }
      );
    });

    // Sort by priority and create transporters
    return configurations
      .sort((a, b) => a.priority - b.priority)
      .map(config => {
        try {
          return {
            ...config,
            transporter: this.createOptimizedTransporter(config)
          };
        } catch (error) {
          logger.error('Error creating transporter for config:', config.name, error);
          return null;
        }
      })
      .filter(config => config !== null); // Remove failed configurations
  }

  /**
   * Create optimized transporter with specific timeout configuration
   */
  createOptimizedTransporter(config) {
    try {
      const transporterConfig = {
        ...config.config,
        connectionTimeout: config.timeouts.connection,
        greetingTimeout: config.timeouts.greeting,
        socketTimeout: config.timeouts.socket,
        debug: process.env.NODE_ENV === 'development' && process.env.DEBUG_SMTP === 'true',
        logger: process.env.NODE_ENV === 'development' && process.env.DEBUG_SMTP === 'true'
      };

      return nodemailer.createTransport(transporterConfig);
    } catch (error) {
      logger.error('Error in createOptimizedTransporter:', error);
      throw error;
    }
  }

  /**
   * Test SMTP configuration with progressive timeouts and detailed timing
   */
  async testSMTPConfigurationWithProgressiveTimeouts(config) {
    const startTime = Date.now();
    let connectionTime = null;
    let verificationTime = null;

    try {
      // Step 1: Test basic connectivity
      logger.debug(`   🔌 Testing connection to ${config.config.host}:${config.config.port}...`);
      
      // Step 2: Verification with custom timeout
      const verificationStartTime = Date.now();
      
      await Promise.race([
        config.transporter.verify(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Verification timeout after ${config.timeouts.verification}ms`)), config.timeouts.verification)
        )
      ]);
      
      verificationTime = Date.now() - verificationStartTime;
      connectionTime = Date.now() - startTime;
      
      logger.debug(`   ✅ Verification successful in ${verificationTime}ms (total: ${connectionTime}ms)`);
      
      return {
        success: true,
        connectionTime,
        verificationTime,
        config: config.config
      };
      
    } catch (error) {
      connectionTime = Date.now() - startTime;
      
      // Enhanced error analysis
      const errorAnalysis = this.analyzeConnectionError(error, connectionTime, config);
      
      logger.debug(`   ❌ Failed after ${connectionTime}ms: ${error.message}`);
      logger.debug(`   📊 Error analysis:`, errorAnalysis);
      
      throw {
        ...error,
        connectionTime,
        analysis: errorAnalysis
      };
    }
  }

  /**
   * Analyze connection errors for better debugging
   */
  analyzeConnectionError(error, connectionTime, config) {
    const analysis = {
      errorType: 'unknown',
      likelyCause: 'unknown',
      suggestions: [],
      severity: 'medium'
    };

    const errorMessage = error.message ? error.message.toLowerCase() : '';
    const errorCode = error.code;

    // Timeout errors
    if (errorMessage.includes('timeout')) {
      analysis.errorType = 'timeout';
      analysis.severity = 'high';
      
      if (connectionTime < 2000) {
        analysis.likelyCause = 'network_blocking';
        analysis.suggestions = [
          'ISP or firewall blocking SMTP ports',
          'Try port 2525 (often unblocked)',
          'Use VPN to test from different network',
          'Check Windows Firewall/Antivirus settings'
        ];
      } else if (connectionTime < 5000) {
        analysis.likelyCause = 'slow_handshake';
        analysis.suggestions = [
          'Slow SMTP server response',
          'Network congestion',
          'Increase timeout values',
          'Try during off-peak hours'
        ];
      } else {
        analysis.likelyCause = 'server_overload';
        analysis.suggestions = [
          'Hostinger SMTP server overloaded',
          'Retry with longer timeouts',
          'Contact Hostinger support',
          'Try alternative configuration'
        ];
      }
    }
    
    // Authentication errors
    else if (errorCode === 'EAUTH' || error.responseCode === 535) {
      analysis.errorType = 'authentication';
      analysis.likelyCause = 'invalid_credentials';
      analysis.severity = 'high';
      analysis.suggestions = [
        'Verify SMTP_USER is correct email address',
        'Check SMTP_PASSWORD is accurate',
        'Ensure email account exists and is active',
        'Login to Hostinger webmail to verify credentials'
      ];
    }
    
    // Network errors
    else if (errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED') {
      analysis.errorType = 'network';
      analysis.likelyCause = 'connectivity_issue';
      analysis.severity = 'high';
      analysis.suggestions = [
        'Check internet connection',
        'Verify SMTP_HOST is correct',
        'DNS resolution may be failing',
        'Try different network connection'
      ];
    }
    
    // TLS/SSL errors
    else if (errorMessage.includes('tls') || errorMessage.includes('ssl')) {
      analysis.errorType = 'tls';
      analysis.likelyCause = 'ssl_handshake_failure';
      analysis.suggestions = [
        'TLS/SSL configuration mismatch',
        'Try port 587 with STARTTLS',
        'Update Node.js version',
        'Check system SSL certificates'
      ];
    }

    return analysis;
  }

  /**
   * Enhanced mock transporter with better development experience
   */
  createMockTransporter() {
    this.isConfigured = false;
    this.mode = 'mock';
    this.transporter = {
      sendMail: async (options) => {
        const mockResult = {
          messageId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          response: 'Mock email sent - Hostinger SMTP not available',
          envelope: {
            from: options.from,
            to: Array.isArray(options.to) ? options.to : [options.to]
          }
        };

        logger.warn('📧 MOCK EMAIL SENT - HOSTINGER SMTP CONNECTION FAILED', {
          to: options.to,
          subject: options.subject,
          messageId: mockResult.messageId,
          mode: this.mode,
          reason: this.lastError?.message || 'Hostinger SMTP configuration failed',
          lastErrorAnalysis: this.lastError?.analysis || 'No detailed analysis available',
          timestamp: new Date().toISOString()
        });

        // Enhanced OTP extraction and display for development
        if (process.env.NODE_ENV === 'development') {
          const otpMatch = options.html?.match(/([0-9]{4,6})/);
          if (otpMatch) {
            console.log('\n🔑 =================================');
            console.log('   DEVELOPMENT OTP FOR TESTING');
            console.log('   (Hostinger SMTP Configuration Issue)');
            console.log('🔑 =================================');
            console.log(`📧 Email: ${options.to}`);
            console.log(`🔑 OTP: ${otpMatch[1]}`);
            console.log(`📋 Type: ${options.headers?.['X-OTP-Type'] || 'verification'}`);
            console.log(`⚠️  Issue: ${this.lastError?.message || 'SMTP configuration failed'}`);
            if (this.lastError?.analysis) {
              console.log(`💡 Suggestion: ${this.lastError.analysis.suggestions[0] || 'Check SMTP configuration'}`);
            }
            console.log('🔑 =================================\n');
          }
        }

        return mockResult;
      },
      verify: async () => {
        throw new Error('Mock transporter - Hostinger SMTP configuration failed');
      },
      close: () => {
        logger.info('Mock transporter closed');
      }
    };

    const errorSummary = this.lastError?.analysis || {};
    
    logger.warn('📧 Email service running in MOCK mode', {
      reason: this.lastError?.message || 'Hostinger SMTP configuration failed',
      errorType: errorSummary.errorType || 'configuration',
      likelyCause: errorSummary.likelyCause || 'missing_or_invalid_credentials',
      developmentMode: process.env.NODE_ENV === 'development',
      suggestions: errorSummary.suggestions || [
        'Verify SMTP credentials in .env file',
        'Check SMTP_HOST=smtp.hostinger.com',
        'Ensure SMTP_USER is valid email address',
        'Verify SMTP_PASSWORD is correct',
        'Try port 587 instead of 465'
      ]
    });
  }

  /**
   * Send OTP email with enhanced error handling
   */
  async sendOTPEmail(email, otp, type = 'verification') {
    const startTime = Date.now();
    
    try {
      logger.info(`📧 Sending ${type} OTP to ${email} via Hostinger (mode: ${this.mode})`);

      // Validate inputs with proper null checks
      if (!email || typeof email !== 'string' || email.trim() === '') {
        throw new Error('Valid email address is required');
      }

      if (!otp || (typeof otp !== 'string' && typeof otp !== 'number')) {
        throw new Error('Valid OTP is required');
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        throw new Error('Invalid email format');
      }

      const emailTemplates = this.getEmailTemplates();
      const template = emailTemplates[type] || emailTemplates.default;

      const mailOptions = {
        from: `"${process.env.APP_NAME || 'Website Builder'}" <${process.env.SMTP_USER || 'noreply@localhost'}>`,
        to: email.trim(),
        subject: template.subject,
        html: template.html(otp),
        text: template.text(otp),
        headers: {
          'X-Mailer': 'Website Builder Backend',
          'X-OTP-Type': type,
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          'Importance': 'high'
        },
        priority: 'high'
      };

      // If in mock mode, handle immediately
      if (this.mode === 'mock') {
        const result = await this.transporter.sendMail(mailOptions);
        const duration = Date.now() - startTime;
        
        logger.warn('📧 OTP sent via MOCK transporter', {
          to: email,
          type,
          messageId: result.messageId,
          mode: this.mode,
          isRealEmail: false,
          duration: `${duration}ms`,
          reason: 'Hostinger SMTP configuration failed'
        });

        return {
          success: false, // Mock mode = not real email
          messageId: result.messageId,
          response: result.response,
          mode: this.mode,
          isRealEmail: false,
          provider: 'hostinger',
          duration,
          otp: process.env.NODE_ENV === 'development' ? otp : undefined
        };
      }

      // Send email with retry logic
      const result = await this.sendWithRetry(mailOptions);
      
      const duration = Date.now() - startTime;
      
      logger.info('📧 OTP email sent successfully via Hostinger', {
        to: email,
        type,
        messageId: result.messageId,
        mode: this.mode,
        isRealEmail: this.isConfigured,
        duration: `${duration}ms`,
        response: result.response
      });

      return {
        success: true,
        messageId: result.messageId,
        response: result.response,
        mode: this.mode,
        isRealEmail: this.isConfigured,
        provider: 'hostinger',
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('📧 Hostinger OTP email send failed', {
        to: email,
        type,
        error: error.message,
        code: error.code,
        command: error.command,
        mode: this.mode,
        configured: this.isConfigured,
        duration: `${duration}ms`
      });

      // In development, return OTP for testing
      if (process.env.NODE_ENV === 'development') {
        logger.warn(`🔑 Hostinger failed - returning OTP for development: ${otp}`);
        return {
          success: false,
          error: error.message,
          otp: otp,
          mode: this.mode,
          isRealEmail: false,
          provider: 'hostinger',
          duration
        };
      }

      throw error;
    }
  }

  /**
   * Get email templates
   */
  getEmailTemplates() {
    const baseStyle = `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
    `;

    const appName = process.env.APP_NAME || 'Website Builder';

    return {
      registration: {
        subject: `Welcome to ${appName} - Verify Your Account`,
        html: (otp) => `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to ${appName}</title>
          </head>
          <body style="margin: 0; padding: 0; ${baseStyle} background-color: #f8fafc;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px;">
              <tr>
                <td align="center">
                  <table width="600" cellpadding="0" cellspacing="0" style="background-color: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
                    <tr>
                      <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">
                          🚀 Welcome to ${appName}!
                        </h1>
                        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">
                          Your multi-tenant website deployment platform
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 40px;">
                        <p style="margin: 0 0 30px; font-size: 16px; color: #64748b;">
                          Thank you for joining <strong>${appName}</strong>! 
                          Please verify your email address with the code below to start building and deploying websites:
                        </p>
                        
                        <div style="background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 30px; text-align: center; margin: 30px 0;">
                          <div style="font-size: 48px; font-weight: bold; color: #1e293b; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                            ${otp}
                          </div>
                        </div>
                        
                        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 30px 0; border-radius: 4px;">
                          <p style="margin: 0; font-size: 14px; color: #92400e;">
                            ⏰ <strong>This verification code expires in 10 minutes</strong>
                          </p>
                        </div>
                        
                        <p style="margin: 0; font-size: 14px; color: #64748b;">
                          If you didn't create this account, please ignore this email.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `,
        text: (otp) => `
Welcome to ${appName}!

Your verification code is: ${otp}

This code will expire in 10 minutes.

If you didn't create this account, please ignore this email.
        `
      },

      default: {
        subject: `Verification Code - ${appName}`,
        html: (otp) => `
          <div style="${baseStyle} max-width: 600px; margin: 0 auto; padding: 40px; background-color: white; border-radius: 8px;">
            <h2 style="color: #1e293b; margin-bottom: 20px;">Verification Required</h2>
            <p style="color: #64748b; margin-bottom: 30px;">Your verification code for ${appName}:</p>
            <div style="background: #f1f5f9; padding: 30px; text-align: center; margin: 30px 0; border-radius: 8px; border: 2px dashed #cbd5e1;">
              <div style="font-size: 36px; font-weight: bold; color: #1e293b; letter-spacing: 6px; font-family: 'Courier New', monospace;">
                ${otp}
              </div>
            </div>
            <p style="color: #64748b; font-size: 14px;">This code will expire in 10 minutes.</p>
          </div>
        `,
        text: (otp) => `Your verification code for ${appName} is: ${otp}\n\nThis code will expire in 10 minutes.`
      }
    };
  }

  /**
   * Send with retry logic
   */
  async sendWithRetry(mailOptions, maxRetries = 2) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Add timeout to individual send attempts
        const sendPromise = this.transporter.sendMail(mailOptions);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Send timeout')), 10000)
        );
        
        const result = await Promise.race([sendPromise, timeoutPromise]);
        return result;
      } catch (error) {
        lastError = error;
        
        logger.warn(`Hostinger send attempt ${attempt} failed:`, {
          error: error.message,
          code: error.code,
          attemptsRemaining: maxRetries - attempt,
          isTimeout: error.message && error.message.includes('timeout')
        });

        // Don't retry on authentication errors
        if (error.code === 'EAUTH' || error.responseCode === 535) {
          throw error;
        }

        // Don't retry on timeout errors - likely systemic issue
        if (error.message && error.message.includes('timeout')) {
          throw error;
        }

        // Don't retry on permanent failures
        if (error.responseCode >= 500 && error.responseCode < 600) {
          // Server errors - worth retrying
        } else if (error.responseCode >= 400 && error.responseCode < 500) {
          // Client errors - don't retry
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
          logger.info(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Send general email
   */
  async sendEmail(to, subject, html, text) {
    try {
      const mailOptions = {
        from: `"${process.env.APP_NAME || 'Website Builder'}" <${process.env.SMTP_USER || 'noreply@localhost'}>`,
        to,
        subject,
        html,
        text
      };

      const result = await this.sendWithRetry(mailOptions);
      
      logger.info('📧 Email sent successfully', {
        to,
        subject,
        messageId: result.messageId,
        mode: this.mode
      });

      return result;
    } catch (error) {
      logger.error('📧 Email send failed:', error);
      throw error;
    }
  }

  /**
   * Test email configuration
   */
  async testEmailConfig() {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      mode: this.mode,
      isConfigured: this.isConfigured,
      connectionAttempts: this.connectionAttempts,
      lastError: this.lastError?.message,
      lastErrorAnalysis: this.lastError?.analysis,
      environment: process.env.NODE_ENV,
      provider: 'hostinger',
      tests: {},
      timeoutConfig: this.timeoutConfig
    };

    try {
      // Test configuration
      const configTest = this.validateEmailConfig();
      diagnostics.tests.configuration = {
        passed: configTest.isValid,
        missing: configTest.missing,
        warnings: configTest.warnings,
        details: configTest.config
      };

      if (!this.isConfigured) {
        return {
          success: false,
          message: `Hostinger SMTP service not configured (mode: ${this.mode})`,
          provider: 'hostinger',
          diagnostics
        };
      }

      // Test connection
      try {
        const startTime = Date.now();
        await Promise.race([
          this.transporter.verify(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Test verification timeout')), 8000)
          )
        ]);
        const verificationTime = Date.now() - startTime;
        
        diagnostics.tests.connection = { 
          passed: true,
          verificationTime: `${verificationTime}ms`
        };
      } catch (error) {
        diagnostics.tests.connection = {
          passed: false,
          error: error.message,
          code: error.code,
          isTimeout: error.message && error.message.includes('timeout')
        };
      }

      const allTestsPassed = Object.values(diagnostics.tests).every(test => test.passed);

      return {
        success: allTestsPassed,
        message: allTestsPassed ? `Hostinger SMTP service working correctly` : `Hostinger SMTP service has issues`,
        mode: this.mode,
        provider: 'hostinger',
        diagnostics
      };

    } catch (error) {
      return {
        success: false,
        message: 'Hostinger SMTP service test failed',
        error: error.message,
        mode: this.mode,
        provider: 'hostinger',
        diagnostics
      };
    }
  }

  /**
   * Close email service
   */
  async close() {
    try {
      if (this.transporter && typeof this.transporter.close === 'function') {
        this.transporter.close();
        logger.info('📧 Email service closed successfully');
      }
    } catch (error) {
      logger.error('Error closing email service:', error);
    }
  }
}

// Create singleton instance
const emailService = new EmailService();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await emailService.close();
});

process.on('SIGINT', async () => {
  await emailService.close();
});

// Export methods for backward compatibility and new features
module.exports = {
  sendOTPEmail: emailService.sendOTPEmail.bind(emailService),
  sendEmail: emailService.sendEmail.bind(emailService),
  testEmailConfig: emailService.testEmailConfig.bind(emailService),
  emailService
};
