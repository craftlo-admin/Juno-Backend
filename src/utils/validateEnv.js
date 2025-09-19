const logger = require('./logger');

/**
 * Multi-tenant Website Builder - Environment Variable Validation
 * Following project architecture: Express.js MVC, comprehensive error handling, production-ready
 * Features: Environment validation, security checks, detailed reporting
 * 
 * @description Validates all required environment variables for multi-tenant website deployment platform
 */

/**
 * Environment variable configuration schema
 */
const ENV_SCHEMA = {
  // Core Application Settings
  NODE_ENV: {
    required: true,
    type: 'string',
    enum: ['development', 'production', 'test'],
    default: 'development',
    description: 'Application environment mode'
  },
  PORT: {
    required: true,
    type: 'number',
    min: 1000,
    max: 65535,
    default: 8000,
    description: 'Server port number'
  },
  APP_NAME: {
    required: true,
    type: 'string',
    minLength: 1,
    default: 'Website Builder',
    description: 'Application name for branding'
  },

  // Database Configuration
  DATABASE_URL: {
    required: true,
    type: 'string',
    pattern: /^postgresql:\/\/.+/,
    description: 'PostgreSQL database connection URL (Supabase)'
  },

  // Redis Configuration
  REDIS_URL: {
    required: false,
    type: 'string',
    pattern: /^redis:\/\/.+/,
    default: 'redis://localhost:6379',
    description: 'Redis connection URL for caching and sessions'
  },

  // JWT Security Configuration
  JWT_SECRET: {
    required: true,
    type: 'string',
    minLength: 32,
    security: true,
    description: 'JWT signing secret key (minimum 32 characters)'
  },
  JWT_EXPIRES_IN: {
    required: false,
    type: 'string',
    default: '7d',
    description: 'JWT token expiration time'
  },
  JWT_REFRESH_SECRET: {
    required: false,
    type: 'string',
    minLength: 32,
    security: true,
    description: 'JWT refresh token secret'
  },
  BCRYPT_SALT_ROUNDS: {
    required: false,
    type: 'number',
    min: 10,
    max: 15,
    default: 12,
    description: 'Bcrypt salt rounds for password hashing'
  },

  // Email Configuration (Hostinger SMTP)
  SMTP_HOST: {
    required: true,
    type: 'string',
    pattern: /^smtp\..+/,
    description: 'SMTP server hostname (Hostinger)'
  },
  SMTP_PORT: {
    required: true,
    type: 'number',
    enum: [25, 465, 587, 2525],
    description: 'SMTP server port'
  },
  SMTP_USER: {
    required: true,
    type: 'string',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    description: 'SMTP authentication username (email address)'
  },
  SMTP_PASSWORD: {
    required: true,
    type: 'string',
    minLength: 1,
    security: true,
    description: 'SMTP authentication password'
  },

  // AWS Configuration
  AWS_REGION: {
    required: false,
    type: 'string',
    default: 'us-east-1',
    description: 'AWS region for S3 and CloudFront'
  },
  AWS_ACCESS_KEY_ID: {
    required: false,
    type: 'string',
    security: true,
    description: 'AWS access key ID for S3 operations'
  },
  AWS_SECRET_ACCESS_KEY: {
    required: false,
    type: 'string',
    security: true,
    description: 'AWS secret access key for S3 operations'
  },
  AWS_S3_BUCKET_STATIC: {
    required: false,
    type: 'string',
    description: 'S3 bucket name for static site deployments'
  },
  AWS_S3_BUCKET_UPLOADS: {
    required: false,
    type: 'string',
    description: 'S3 bucket name for ZIP file uploads'
  },
  S3_BUCKET_NAME: {
    required: false,
    type: 'string',
    description: 'S3 bucket name for general file storage (legacy)'
  },

  // Application Configuration
  BASE_DOMAIN: {
    required: false,
    type: 'string',
    pattern: /^https?:\/\/.+/,
    default: 'http://localhost:3000',
    description: 'Base domain for the application'
  },
  MAX_UPLOAD_SIZE: {
    required: false,
    type: 'string',
    default: '100mb',
    description: 'Maximum file upload size'
  },

  // Build Configuration
  BUILD_TIMEOUT: {
    required: false,
    type: 'number',
    min: 30000,
    max: 1800000,
    default: 600000,
    description: 'Build timeout in milliseconds'
  },
  MAX_CONCURRENT_BUILDS: {
    required: false,
    type: 'number',
    min: 1,
    max: 20,
    default: 5,
    description: 'Maximum concurrent builds allowed'
  },
  BUILD_WORKER_COUNT: {
    required: false,
    type: 'number',
    min: 1,
    max: 10,
    default: 2,
    description: 'Number of build worker processes'
  },

  // Storage Configuration
  UPLOAD_PATH: {
    required: false,
    type: 'string',
    default: './uploads',
    description: 'Local upload directory path'
  },
  MAX_FILE_SIZE: {
    required: false,
    type: 'string',
    default: '100mb',
    description: 'Maximum individual file size'
  },
  ALLOWED_FILE_TYPES: {
    required: false,
    type: 'string',
    default: 'html,css,js,png,jpg,jpeg,gif,svg,ico,json,xml,txt',
    description: 'Comma-separated list of allowed file extensions'
  },

  // Security Configuration
  RATE_LIMIT_WINDOW: {
    required: false,
    type: 'number',
    min: 60000,
    default: 900000,
    description: 'Rate limiting window in milliseconds'
  },
  RATE_LIMIT_MAX_REQUESTS: {
    required: false,
    type: 'number',
    min: 10,
    default: 100,
    description: 'Maximum requests per rate limit window'
  },
  SESSION_SECRET: {
    required: false,
    type: 'string',
    minLength: 32,
    security: true,
    description: 'Session secret for cookie signing'
  },

  // Development Settings
  DEBUG_MODE: {
    required: false,
    type: 'boolean',
    default: false,
    description: 'Enable debug mode for development'
  },
  LOG_LEVEL: {
    required: false,
    type: 'string',
    enum: ['error', 'warn', 'info', 'debug'],
    default: 'info',
    description: 'Logging level'
  },

  // Monitoring Configuration
  ENABLE_METRICS: {
    required: false,
    type: 'boolean',
    default: false,
    description: 'Enable application metrics collection'
  },
  METRICS_PORT: {
    required: false,
    type: 'number',
    min: 1000,
    max: 65535,
    default: 9090,
    description: 'Port for metrics endpoint'
  }
};

/**
 * Validation result structure
 */
class ValidationResult {
  constructor() {
    this.isValid = true;
    this.errors = [];
    this.warnings = [];
    this.missing = [];
    this.invalid = [];
    this.security = [];
    this.applied = [];
    this.summary = {};
  }

  addError(key, message, category = 'validation') {
    this.isValid = false;
    this.errors.push({ key, message, category });
    
    switch (category) {
      case 'missing':
        this.missing.push(key);
        break;
      case 'invalid':
        this.invalid.push(key);
        break;
      case 'security':
        this.security.push(key);
        break;
    }
  }

  addWarning(key, message) {
    this.warnings.push({ key, message });
  }

  addApplied(key, value, isDefault = false) {
    this.applied.push({ key, value, isDefault });
  }
}

/**
 * Type conversion utilities
 */
const TypeConverters = {
  string: (value) => String(value),
  number: (value) => {
    const num = Number(value);
    if (isNaN(num)) throw new Error('Invalid number format');
    return num;
  },
  boolean: (value) => {
    if (typeof value === 'boolean') return value;
    const str = String(value).toLowerCase();
    if (str === 'true' || str === '1' || str === 'yes') return true;
    if (str === 'false' || str === '0' || str === 'no') return false;
    throw new Error('Invalid boolean format');
  }
};

/**
 * Validate individual environment variable
 */
function validateEnvVar(key, schema, value) {
  const errors = [];
  
  // Type conversion
  let convertedValue = value;
  if (value !== undefined && schema.type && TypeConverters[schema.type]) {
    try {
      convertedValue = TypeConverters[schema.type](value);
    } catch (error) {
      errors.push(`Invalid ${schema.type}: ${error.message}`);
      return { value: convertedValue, errors };
    }
  }

  // Enum validation
  if (schema.enum && convertedValue !== undefined) {
    if (!schema.enum.includes(convertedValue)) {
      errors.push(`Must be one of: ${schema.enum.join(', ')}`);
    }
  }

  // Pattern validation
  if (schema.pattern && convertedValue !== undefined) {
    if (!schema.pattern.test(String(convertedValue))) {
      errors.push('Does not match required pattern');
    }
  }

  // Range validation for numbers
  if (schema.type === 'number' && convertedValue !== undefined) {
    if (schema.min !== undefined && convertedValue < schema.min) {
      errors.push(`Must be at least ${schema.min}`);
    }
    if (schema.max !== undefined && convertedValue > schema.max) {
      errors.push(`Must be at most ${schema.max}`);
    }
  }

  // String length validation
  if (schema.type === 'string' && convertedValue !== undefined) {
    if (schema.minLength !== undefined && convertedValue.length < schema.minLength) {
      errors.push(`Must be at least ${schema.minLength} characters long`);
    }
    if (schema.maxLength !== undefined && convertedValue.length > schema.maxLength) {
      errors.push(`Must be at most ${schema.maxLength} characters long`);
    }
  }

  return { value: convertedValue, errors };
}

/**
 * Main environment validation function
 */
function validateEnvironment(envOverrides = {}) {
  const result = new ValidationResult();
  const env = { ...process.env, ...envOverrides };
  const processedEnv = {};

  logger.info('🔍 Starting environment variable validation...');

  // Validate each environment variable
  for (const [key, schema] of Object.entries(ENV_SCHEMA)) {
    const rawValue = env[key];
    let finalValue = rawValue;
    let isDefault = false;

    // Check if required variable is missing
    if (schema.required && (rawValue === undefined || rawValue === '')) {
      result.addError(key, `Required environment variable is missing: ${schema.description}`, 'missing');
      continue;
    }

    // Apply default value if missing
    if ((rawValue === undefined || rawValue === '') && schema.default !== undefined) {
      finalValue = schema.default;
      isDefault = true;
    }

    // Skip validation if still undefined/empty
    if (finalValue === undefined || finalValue === '') {
      continue;
    }

    // Validate the value
    const validation = validateEnvVar(key, schema, finalValue);
    
    if (validation.errors.length > 0) {
      const errorMessage = `${validation.errors.join(', ')} (${schema.description})`;
      result.addError(key, errorMessage, 'invalid');
      continue;
    }

    // Store processed value
    processedEnv[key] = validation.value;
    result.addApplied(key, validation.value, isDefault);

    // Security warnings for weak values
    if (schema.security) {
      if (schema.type === 'string' && schema.minLength) {
        if (String(validation.value).length < schema.minLength * 1.5) {
          result.addWarning(key, `Consider using a longer ${key} for better security`);
        }
      }
      
      // Check for common weak patterns
      const weakPatterns = ['password', '123456', 'admin', 'secret', 'default'];
      const valueStr = String(validation.value).toLowerCase();
      if (weakPatterns.some(pattern => valueStr.includes(pattern))) {
        result.addWarning(key, `${key} appears to contain common weak patterns`);
      }
    }
  }

  // Environment-specific validations
  validateEnvironmentSpecific(result, processedEnv);

  // Generate summary
  result.summary = {
    total: Object.keys(ENV_SCHEMA).length,
    processed: result.applied.length,
    defaults: result.applied.filter(a => a.isDefault).length,
    errors: result.errors.length,
    warnings: result.warnings.length,
    missing: result.missing.length,
    invalid: result.invalid.length,
    security: result.security.length
  };

  return { result, processedEnv };
}

/**
 * Environment-specific validation rules
 */
function validateEnvironmentSpecific(result, env) {
  // Production environment checks
  if (env.NODE_ENV === 'production') {
    const productionRequired = ['JWT_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'];
    
    productionRequired.forEach(key => {
      if (!env[key]) {
        result.addError(key, `${key} is required in production environment`, 'security');
      }
    });

    // Check for development values in production
    if (env.JWT_SECRET && env.JWT_SECRET.length < 64) {
      result.addWarning('JWT_SECRET', 'Consider using a longer JWT secret in production');
    }

    if (env.BASE_DOMAIN && env.BASE_DOMAIN.includes('localhost')) {
      result.addWarning('BASE_DOMAIN', 'BASE_DOMAIN should not contain localhost in production');
    }
  }

  // Database URL validation
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      if (!url.hostname || !url.pathname) {
        result.addError('DATABASE_URL', 'Invalid database URL format', 'invalid');
      }
    } catch (error) {
      result.addError('DATABASE_URL', 'Malformed database URL', 'invalid');
    }
  }

  // SMTP configuration consistency
  if (env.SMTP_HOST && env.SMTP_PORT) {
    const hostPortMap = {
      'smtp.hostinger.com': [25, 465, 587, 2525],
      'smtp.gmail.com': [465, 587],
      'smtp.outlook.com': [587]
    };

    const validPorts = hostPortMap[env.SMTP_HOST];
    if (validPorts && !validPorts.includes(env.SMTP_PORT)) {
      result.addWarning('SMTP_PORT', `Port ${env.SMTP_PORT} may not be optimal for ${env.SMTP_HOST}`);
    }
  }

  // AWS configuration validation
  const awsVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET_NAME'];
  const awsConfigured = awsVars.filter(key => env[key] && env[key] !== 'dev-placeholder').length;
  
  if (awsConfigured > 0 && awsConfigured < awsVars.length) {
    result.addWarning('AWS_CONFIG', 'Partial AWS configuration detected - some features may not work');
  }
}

/**
 * Display validation results
 */
function displayValidationResults(result) {
  const { summary } = result;
  
  console.log('\n📋 ENVIRONMENT VALIDATION RESULTS');
  console.log('═'.repeat(50));
  
  // Summary
  console.log(`\n📊 Summary:`);
  console.log(`   Total Variables: ${summary.total}`);
  console.log(`   Processed: ${summary.processed}`);
  console.log(`   Defaults Applied: ${summary.defaults}`);
  console.log(`   ✅ Valid: ${summary.processed - summary.errors}`);
  console.log(`   ❌ Errors: ${summary.errors}`);
  console.log(`   ⚠️  Warnings: ${summary.warnings}`);
  
  // Errors
  if (result.errors.length > 0) {
    console.log(`\n❌ ERRORS (${result.errors.length}):`);
    result.errors.forEach(error => {
      console.log(`   • ${error.key}: ${error.message}`);
    });
  }
  
  // Warnings
  if (result.warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS (${result.warnings.length}):`);
    result.warnings.forEach(warning => {
      console.log(`   • ${warning.key}: ${warning.message}`);
    });
  }
  
  // Applied defaults
  const defaults = result.applied.filter(a => a.isDefault);
  if (defaults.length > 0) {
    console.log(`\n🔧 DEFAULTS APPLIED (${defaults.length}):`);
    defaults.forEach(def => {
      console.log(`   • ${def.key}: ${def.value}`);
    });
  }
  
  console.log(`\n${result.isValid ? '✅ Environment validation passed!' : '❌ Environment validation failed!'}`);
  console.log('');
}

/**
 * Quick validation function for server startup
 */
function quickValidate() {
  try {
    const { result } = validateEnvironment();
    
    if (!result.isValid) {
      logger.error('Environment validation failed', {
        errors: result.errors.length,
        missing: result.missing,
        invalid: result.invalid
      });
      
      if (process.env.NODE_ENV === 'development') {
        displayValidationResults(result);
      }
      
      return false;
    }
    
    if (result.warnings.length > 0) {
      logger.warn(`Environment validation passed with ${result.warnings.length} warnings`, {
        warnings: result.warnings.map(w => w.key)
      });
    } else {
      logger.info('✅ Environment validation passed successfully');
    }
    
    return true;
  } catch (error) {
    logger.error('Environment validation error:', error);
    return false;
  }
}

/**
 * Comprehensive validation with detailed output
 */
function fullValidate() {
  try {
    const { result, processedEnv } = validateEnvironment();
    
    displayValidationResults(result);
    
    return {
      isValid: result.isValid,
      result,
      processedEnv
    };
  } catch (error) {
    logger.error('Full environment validation error:', error);
    return {
      isValid: false,
      error: error.message
    };
  }
}

/**
 * Get environment variable with validation
 */
function getEnv(key, fallback = undefined) {
  const schema = ENV_SCHEMA[key];
  const value = process.env[key];
  
  if (!value && schema && schema.default !== undefined) {
    return schema.default;
  }
  
  if (!value && fallback !== undefined) {
    return fallback;
  }
  
  if (!value && schema && schema.required) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  
  if (value && schema) {
    const validation = validateEnvVar(key, schema, value);
    if (validation.errors.length > 0) {
      logger.warn(`Environment variable ${key} validation warning:`, validation.errors);
    }
    return validation.value;
  }
  
  return value;
}

// Export functions and schema
module.exports = {
  validateEnvironment,
  quickValidate,
  fullValidate,
  displayValidationResults,
  getEnv,
  ENV_SCHEMA,
  ValidationResult
};

// Allow running validation directly
if (require.main === module) {
  console.log('🚀 Website Builder - Environment Validation Tool');
  console.log('═'.repeat(50));
  
  const validation = fullValidate();
  
  if (validation.isValid) {
    console.log('\n🎉 Environment is properly configured!');
    process.exit(0);
  } else {
    console.log('\n🔧 Environment needs attention. Fix the errors above.');
    process.exit(1);
  }
}