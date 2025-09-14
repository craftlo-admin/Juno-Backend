const AWS = require('aws-sdk');
const logger = require('../utils/logger');

// Check if AWS credentials are real or placeholders
const isAwsConfigured = process.env.AWS_ACCESS_KEY_ID !== 'dev-placeholder' && 
                       process.env.AWS_SECRET_ACCESS_KEY !== 'dev-placeholder';

if (!isAwsConfigured) {
  logger.warn('AWS credentials not configured. AWS services will be disabled in development mode.');
}

// Configure AWS only if credentials are real
let s3Client = null;
let cloudFrontClient = null;
let lambdaClient = null;

if (isAwsConfigured) {
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
  });

  s3Client = new AWS.S3();
  cloudFrontClient = new AWS.CloudFront();
  lambdaClient = new AWS.Lambda();
  
  logger.info('AWS services configured successfully');
} else {
  // Mock clients for development
  const mockClient = {
    upload: () => Promise.resolve({ Location: 'http://localhost:8000/mock-upload' }),
    deleteObject: () => Promise.resolve(),
    listObjects: () => Promise.resolve({ Contents: [] }),
    getSignedUrl: () => 'http://localhost:8000/mock-signed-url'
  };
  
  s3Client = mockClient;
  cloudFrontClient = mockClient;
  lambdaClient = mockClient;
}

module.exports = {
  s3: s3Client,
  cloudFront: cloudFrontClient,
  lambda: lambdaClient,
  isAwsConfigured
};
