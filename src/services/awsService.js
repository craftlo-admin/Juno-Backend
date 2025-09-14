const AWS = require('aws-sdk');
const logger = require('../utils/logger');

/**
 * Multi-tenant AWS Service Integration
 * Following project architecture: comprehensive error handling, security, logging
 */

// Configure AWS
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3({
  apiVersion: '2006-03-01',
  httpOptions: {
    timeout: 120000, // 2 minutes timeout
    connectTimeout: 5000 // 5 seconds connect timeout
  },
  maxRetries: 3,
  retryDelayOptions: {
    customBackoff: function(retryCount) {
      return Math.pow(2, retryCount) * 100; // Exponential backoff
    }
  }
});

/**
 * Upload file to S3 with comprehensive error handling
 */
async function uploadToS3(buffer, key, contentType, options = {}) {
  const startTime = Date.now();
  
  try {
    // Validate inputs
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer is empty or invalid');
    }

    if (!key) {
      throw new Error('S3 key is required');
    }

    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }

    // Prepare upload parameters
    const uploadParams = {
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
      ServerSideEncryption: 'AES256',
      Metadata: {
        uploadedAt: new Date().toISOString(),
        ...options.metadata
      },
      ...options
    };

    logger.info('Starting S3 upload:', {
      bucket: bucketName,
      key,
      contentType,
      size: buffer.length
    });

    // Upload to S3
    const result = await s3.upload(uploadParams).promise();
    
    const duration = Date.now() - startTime;

    logger.info('S3 upload successful:', {
      bucket: result.Bucket,
      key: result.Key,
      location: result.Location,
      etag: result.ETag,
      size: buffer.length,
      duration: `${duration}ms`
    });

    return {
      Bucket: result.Bucket,
      Key: result.Key,
      Location: result.Location,
      ETag: result.ETag,
      url: result.Location
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('S3 upload failed:', {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      key,
      contentType,
      size: buffer?.length,
      duration: `${duration}ms`
    });

    // Re-throw with more context
    throw new Error(`S3 upload failed: ${error.message}`);
  }
}

/**
 * Delete file from S3
 */
async function deleteFromS3(key) {
  try {
    if (!key) {
      throw new Error('S3 key is required');
    }

    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }

    const deleteParams = {
      Bucket: bucketName,
      Key: key
    };

    logger.info('Deleting from S3:', {
      bucket: bucketName,
      key
    });

    const result = await s3.deleteObject(deleteParams).promise();

    logger.info('S3 deletion successful:', {
      bucket: bucketName,
      key,
      deleteMarker: result.DeleteMarker,
      versionId: result.VersionId
    });

    return result;

  } catch (error) {
    logger.error('S3 deletion failed:', {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      key
    });

    throw new Error(`S3 deletion failed: ${error.message}`);
  }
}

/**
 * Get signed URL for temporary access
 */
async function getSignedUrl(key, expiresIn = 3600) {
  try {
    if (!key) {
      throw new Error('S3 key is required');
    }

    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }

    const params = {
      Bucket: bucketName,
      Key: key,
      Expires: expiresIn
    };

    const url = await s3.getSignedUrlPromise('getObject', params);

    logger.info('Generated signed URL:', {
      bucket: bucketName,
      key,
      expiresIn
    });

    return url;

  } catch (error) {
    logger.error('Signed URL generation failed:', {
      error: error.message,
      key,
      expiresIn
    });

    throw new Error(`Signed URL generation failed: ${error.message}`);
  }
}

/**
 * Check if S3 bucket exists and is accessible
 */
async function testS3Connection() {
  try {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }

    // Try to head the bucket
    await s3.headBucket({ Bucket: bucketName }).promise();

    logger.info('S3 connection test successful:', {
      bucket: bucketName
    });

    return {
      success: true,
      bucket: bucketName,
      region: process.env.AWS_REGION
    };

  } catch (error) {
    logger.error('S3 connection test failed:', {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      bucket: process.env.S3_BUCKET_NAME
    });

    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
}

module.exports = {
  uploadToS3,
  deleteFromS3,
  getSignedUrl,
  testS3Connection,
  s3
};