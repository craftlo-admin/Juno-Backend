const { s3 } = require('../config/aws');
const logger = require('../utils/logger');

class StorageService {
  static async uploadToS3({ key, body, contentType, bucket, metadata = {} }) {
    try {
      const params = {
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata
      };

      const result = await s3.upload(params).promise();
      logger.info(`File uploaded to S3: ${result.Location}`);
      return result;
    } catch (error) {
      logger.error('S3 upload error:', error);
      throw new Error(`Failed to upload to S3: ${error.message}`);
    }
  }

  static async getFromS3({ key, bucket }) {
    try {
      const params = {
        Bucket: bucket,
        Key: key
      };

      const result = await s3.getObject(params).promise();
      return result;
    } catch (error) {
      if (error.code === 'NoSuchKey') {
        throw new Error('File not found in S3');
      }
      logger.error('S3 get error:', error);
      throw new Error(`Failed to get from S3: ${error.message}`);
    }
  }

  static async deleteFromS3({ key, bucket }) {
    try {
      const params = {
        Bucket: bucket,
        Key: key
      };

      await s3.deleteObject(params).promise();
      logger.info(`File deleted from S3: ${key}`);
    } catch (error) {
      logger.error('S3 delete error:', error);
      throw new Error(`Failed to delete from S3: ${error.message}`);
    }
  }

  static async listS3Objects({ bucket, prefix, maxKeys = 1000, startAfter }) {
    try {
      const params = {
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: maxKeys
      };

      // Add pagination support
      if (startAfter) {
        params.StartAfter = startAfter;
      }

      const result = await s3.listObjectsV2(params).promise();
      return result.Contents || [];
    } catch (error) {
      logger.error('S3 list error:', error);
      throw new Error(`Failed to list S3 objects: ${error.message}`);
    }
  }

  static async getSignedUploadUrl({ key, bucket, contentType, expiresIn = 3600 }) {
    try {
      const params = {
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Expires: expiresIn
      };

      const url = await s3.getSignedUrlPromise('putObject', params);
      return url;
    } catch (error) {
      logger.error('S3 signed URL error:', error);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  static async copyS3Object({ sourceBucket, sourceKey, destBucket, destKey }) {
    try {
      const params = {
        Bucket: destBucket,
        CopySource: `${sourceBucket}/${sourceKey}`,
        Key: destKey
      };

      const result = await s3.copyObject(params).promise();
      logger.info(`File copied in S3: ${sourceKey} -> ${destKey}`);
      return result;
    } catch (error) {
      logger.error('S3 copy error:', error);
      throw new Error(`Failed to copy in S3: ${error.message}`);
    }
  }

  static async syncDirectoryToS3({ localDir, bucket, s3Prefix }) {
    // This would be implemented for build artifact sync
    // For now, we'll implement a placeholder
    logger.info(`Sync directory ${localDir} to S3://${bucket}/${s3Prefix}`);
    // Implementation would use fs to read directory and upload files
  }

  static async deleteS3Directory({ bucket, prefix }) {
    try {
      // List all objects with the prefix
      const objects = await this.listS3Objects({ bucket, prefix });
      
      if (objects.length === 0) {
        return;
      }

      // Delete all objects
      const deleteParams = {
        Bucket: bucket,
        Delete: {
          Objects: objects.map(obj => ({ Key: obj.Key }))
        }
      };

      await s3.deleteObjects(deleteParams).promise();
      logger.info(`Directory deleted from S3: ${prefix}`);
    } catch (error) {
      logger.error('S3 directory delete error:', error);
      throw new Error(`Failed to delete S3 directory: ${error.message}`);
    }
  }

  static async uploadFile(filePath, key, bucket = process.env.AWS_S3_BUCKET_UPLOADS || process.env.AWS_S3_BUCKET_NAME) {
    try {
      const fs = require('fs');
      const path = require('path');
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Read file
      const fileStream = fs.createReadStream(filePath);
      
      // Determine content type based on file extension
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'application/octet-stream';
      
      if (ext === '.zip') {
        contentType = 'application/zip';
      } else if (ext === '.tar') {
        contentType = 'application/x-tar';
      } else if (ext === '.gz') {
        contentType = 'application/gzip';
      }

      const params = {
        Bucket: bucket,
        Key: key,
        Body: fileStream,
        ContentType: contentType
      };

      const result = await s3.upload(params).promise();
      logger.info(`File uploaded to S3: ${result.Location}`);
      
      // Clean up local file after successful upload
      fs.unlinkSync(filePath);
      logger.info(`Local file cleaned up: ${filePath}`);
      
      return result;
    } catch (error) {
      logger.error('File upload error:', error);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  static async downloadFromS3({ key, bucket, localPath }) {
    const fs = require('fs');
    const path = require('path');
    
    try {
      const params = {
        Bucket: bucket,
        Key: key
      };

      logger.info(`Downloading from S3: ${key} from bucket ${bucket} to ${localPath}`);

      // Ensure directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create a write stream to the local file
      const writeStream = fs.createWriteStream(localPath);
      
      // Get the S3 object as a stream
      const s3Stream = s3.getObject(params).createReadStream();
      
      return new Promise((resolve, reject) => {
        s3Stream.pipe(writeStream)
          .on('error', (error) => {
            logger.error('S3 download stream error:', error);
            reject(new Error(`Failed to download from S3: ${error.message}`));
          })
          .on('close', () => {
            logger.info(`File downloaded successfully: ${localPath}`);
            resolve(localPath);
          });
      });
    } catch (error) {
      if (error.code === 'NoSuchKey') {
        throw new Error(`File not found in S3: ${key}`);
      }
      logger.error('S3 download error:', error);
      throw new Error(`Failed to download from S3: ${error.message}`);
    }
  }
}

module.exports = {
  uploadToS3: StorageService.uploadToS3.bind(StorageService),
  uploadFile: StorageService.uploadFile.bind(StorageService),
  getFromS3: StorageService.getFromS3.bind(StorageService),
  downloadFromS3: StorageService.downloadFromS3.bind(StorageService),
  deleteFromS3: StorageService.deleteFromS3.bind(StorageService),
  listS3Objects: StorageService.listS3Objects.bind(StorageService),
  getSignedUploadUrl: StorageService.getSignedUploadUrl.bind(StorageService),
  copyS3Object: StorageService.copyS3Object.bind(StorageService),
  syncDirectoryToS3: StorageService.syncDirectoryToS3.bind(StorageService),
  deleteS3Directory: StorageService.deleteS3Directory.bind(StorageService)
};
