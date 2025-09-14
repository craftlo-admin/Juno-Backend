const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

/**
 * Scan directory for malware using ClamAV
 * @param {string} scanPath - Path to scan
 * @returns {Promise<boolean>} - True if clean, throws error if malware found
 */
async function scanForMalware(scanPath) {
  try {
    // Check if ClamAV is available
    const clamAvAvailable = await checkClamAvailability();
    
    if (!clamAvAvailable) {
      logger.warn('ClamAV not available, skipping malware scan');
      return true;
    }

    logger.info(`Starting malware scan: ${scanPath}`);
    
    const result = await runClamScan(scanPath);
    
    if (result.infected > 0) {
      throw new Error(`Malware detected: ${result.infected} infected files found`);
    }
    
    logger.info(`Malware scan completed: ${scanPath} - Clean`);
    return true;
    
  } catch (error) {
    logger.error('Malware scan failed:', error);
    throw new Error(`Security scan failed: ${error.message}`);
  }
}

/**
 * Perform basic static security checks on uploaded files
 * @param {string} scanPath - Path to scan
 * @returns {Promise<Array>} - Array of security issues found
 */
async function performStaticSecurityChecks(scanPath) {
  const issues = [];
  
  try {
    // Check for suspicious file extensions
    const suspiciousFiles = await findSuspiciousFiles(scanPath);
    if (suspiciousFiles.length > 0) {
      issues.push({
        type: 'suspicious_files',
        severity: 'high',
        message: `Suspicious files found: ${suspiciousFiles.join(', ')}`,
        files: suspiciousFiles
      });
    }

    // Check for executable files
    const executableFiles = await findExecutableFiles(scanPath);
    if (executableFiles.length > 0) {
      issues.push({
        type: 'executable_files',
        severity: 'medium',
        message: `Executable files found: ${executableFiles.join(', ')}`,
        files: executableFiles
      });
    }

    // Check for files that are too large
    const largeFiles = await findLargeFiles(scanPath, 50 * 1024 * 1024); // 50MB limit
    if (largeFiles.length > 0) {
      issues.push({
        type: 'large_files',
        severity: 'low',
        message: `Large files found (>50MB): ${largeFiles.join(', ')}`,
        files: largeFiles
      });
    }

    // Check for hidden files/directories
    const hiddenFiles = await findHiddenFiles(scanPath);
    if (hiddenFiles.length > 0) {
      issues.push({
        type: 'hidden_files',
        severity: 'low',
        message: `Hidden files/directories found: ${hiddenFiles.join(', ')}`,
        files: hiddenFiles
      });
    }

  } catch (error) {
    logger.error('Static security check failed:', error);
    issues.push({
      type: 'scan_error',
      severity: 'high',
      message: `Security check failed: ${error.message}`
    });
  }
  
  return issues;
}

async function checkClamAvailability() {
  return new Promise((resolve) => {
    const process = spawn('clamscan', ['--version'], { stdio: 'ignore' });
    
    process.on('close', (code) => {
      resolve(code === 0);
    });
    
    process.on('error', () => {
      resolve(false);
    });
  });
}

async function runClamScan(scanPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--recursive',
      '--infected',
      '--no-summary',
      scanPath
    ];
    
    const process = spawn('clamscan', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      // ClamAV exit codes: 0 = clean, 1 = infected, 2 = error
      if (code === 0) {
        resolve({ infected: 0, clean: true });
      } else if (code === 1) {
        const infectedFiles = stdout.split('\n')
          .filter(line => line.includes('FOUND'))
          .length;
        resolve({ infected: infectedFiles, clean: false, output: stdout });
      } else {
        reject(new Error(`ClamAV scan failed: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
}

async function findSuspiciousFiles(scanPath) {
  const suspiciousExtensions = [
    '.exe', '.bat', '.cmd', '.com', '.scr', '.pif',
    '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
    '.ps1', '.ps1xml', '.ps2', '.ps2xml', '.psc1', '.psc2',
    '.sh', '.bash', '.csh', '.fish', '.ksh', '.zsh',
    '.php', '.asp', '.aspx', '.jsp'
  ];
  
  const suspicious = [];
  await scanDirectoryForExtensions(scanPath, suspiciousExtensions, suspicious);
  return suspicious;
}

async function findExecutableFiles(scanPath) {
  const executable = [];
  
  async function checkExecutable(filePath) {
    try {
      const stats = await fs.stat(filePath);
      // Check if file has execute permissions (Unix-like systems)
      if (stats.mode & parseInt('111', 8)) {
        executable.push(path.relative(scanPath, filePath));
      }
    } catch (error) {
      // Ignore errors for individual files
    }
  }
  
  await scanDirectory(scanPath, checkExecutable);
  return executable;
}

async function findLargeFiles(scanPath, sizeLimit) {
  const large = [];
  
  async function checkSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > sizeLimit) {
        large.push(path.relative(scanPath, filePath));
      }
    } catch (error) {
      // Ignore errors for individual files
    }
  }
  
  await scanDirectory(scanPath, checkSize);
  return large;
}

async function findHiddenFiles(scanPath) {
  const hidden = [];
  
  async function checkHidden(filePath) {
    const relativePath = path.relative(scanPath, filePath);
    const parts = relativePath.split(path.sep);
    
    // Check if any part of the path starts with a dot (hidden on Unix-like systems)
    for (const part of parts) {
      if (part.startsWith('.') && part !== '.' && part !== '..') {
        hidden.push(relativePath);
        break;
      }
    }
  }
  
  await scanDirectory(scanPath, checkHidden);
  return hidden;
}

async function scanDirectory(dirPath, fileCallback) {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      
      if (item.isDirectory()) {
        await scanDirectory(fullPath, fileCallback);
      } else if (item.isFile()) {
        await fileCallback(fullPath);
      }
    }
  } catch (error) {
    // Ignore directory access errors
  }
}

async function scanDirectoryForExtensions(dirPath, extensions, results) {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      
      if (item.isDirectory()) {
        await scanDirectoryForExtensions(fullPath, extensions, results);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(path.relative(dirPath, fullPath));
        }
      }
    }
  } catch (error) {
    // Ignore directory access errors
  }
}

module.exports = {
  scanForMalware,
  performStaticSecurityChecks
};
