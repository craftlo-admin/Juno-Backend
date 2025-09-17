const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const AdmZip = require('adm-zip');

const router = express.Router();

/**
 * Simple ZIP file validation function
 */
async function validateZipFile(zipFilePath) {
  try {
    const stats = await fs.stat(zipFilePath);
    
    if (stats.size === 0) {
      return { isValid: false, error: 'ZIP file is empty (0 bytes)' };
    }
    
    if (stats.size < 22) {
      return { isValid: false, error: `ZIP file too small (${stats.size} bytes) - likely corrupted` };
    }
    
    // Test if it's a valid ZIP by trying to read it
    const zip = new AdmZip(zipFilePath);
    const entries = zip.getEntries();
    
    if (entries.length === 0) {
      return { isValid: false, error: 'ZIP file appears to be empty - no entries found' };
    }
    
    return { 
      isValid: true, 
      entryCount: entries.length,
      entries: entries.slice(0, 10).map(entry => ({
        name: entry.entryName,
        size: entry.header.size,
        isDirectory: entry.isDirectory
      }))
    };
    
  } catch (error) {
    return { isValid: false, error: `ZIP validation failed: ${error.message}` };
  }
}

/**
 * Test endpoint to validate ZIP files
 * POST /api/test/validate-zip
 */
router.post('/validate-zip', async (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'File path is required'
      });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (accessError) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
        path: filePath
      });
    }

    // Validate the ZIP file
    const validationResult = await validateZipFile(filePath);
    
    return res.json({
      success: true,
      validation: validationResult,
      filePath
    });

  } catch (error) {
    console.error('ZIP validation test error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

/**
 * List available test ZIP files
 * GET /api/test/list-zips
 */
router.get('/list-zips', async (req, res) => {
  try {
    const tempDir = path.join(__dirname, '../../temp');
    
    // Recursively find ZIP files
    async function findZipFiles(dir) {
      const files = [];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            const subFiles = await findZipFiles(fullPath);
            files.push(...subFiles);
          } else if (entry.name.toLowerCase().endsWith('.zip')) {
            const stats = await fs.stat(fullPath);
            files.push({
              path: fullPath,
              name: entry.name,
              size: stats.size,
              modified: stats.mtime
            });
          }
        }
      } catch (dirError) {
        // Directory doesn't exist or can't be read
      }
      
      return files;
    }
    
    const zipFiles = await findZipFiles(tempDir);
    
    return res.json({
      success: true,
      files: zipFiles,
      count: zipFiles.length
    });

  } catch (error) {
    console.error('List ZIP files error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;