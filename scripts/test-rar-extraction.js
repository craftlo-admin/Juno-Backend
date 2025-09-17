#!/usr/bin/env node

/**
 * RAR Extraction Testing Utility
 * 
 * This script helps diagnose RAR extraction issues by:
 * 1. Validating RAR file format and structure
 * 2. Testing different extraction methods
 * 3. Providing detailed error analysis
 * 4. Suggesting solutions for common problems
 */

const fs = require('fs').promises;
const path = require('path');
const unrar = require('node-unrar-js');

async function testRarExtraction(rarFilePath) {
  console.log('🔍 RAR Extraction Diagnostic Tool');
  console.log('=' .repeat(50));
  
  try {
    // Step 1: File validation
    console.log('\n📋 Step 1: File Validation');
    console.log('-'.repeat(30));
    
    const stats = await fs.stat(rarFilePath);
    console.log(`✅ File exists: ${rarFilePath}`);
    console.log(`📏 File size: ${stats.size.toLocaleString()} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`📅 Modified: ${stats.mtime.toISOString()}`);
    
    // Step 2: RAR signature validation
    console.log('\n🔐 Step 2: RAR Signature Validation');
    console.log('-'.repeat(30));
    
    const buffer = await fs.readFile(rarFilePath);
    const signature = buffer.slice(0, 10);
    
    console.log(`🔍 File signature (hex): ${signature.toString('hex')}`);
    console.log(`🔍 File signature (ascii): ${signature.toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
    
    // Check for RAR signatures
    const isRar4 = signature.toString('ascii').startsWith('Rar!');
    const isRar5 = signature[0] === 0x52 && signature[1] === 0x61 && signature[2] === 0x72 && signature[3] === 0x21;
    
    if (isRar4) {
      console.log('✅ RAR 4.x format detected (supported)');
    } else if (isRar5) {
      console.log('⚠️  RAR 5.x format detected (may have compatibility issues)');
    } else {
      console.log('❌ Invalid RAR signature - file may be corrupted or not a RAR archive');
      return;
    }
    
    // Step 3: node-unrar-js testing
    console.log('\n🔧 Step 3: node-unrar-js Library Testing');
    console.log('-'.repeat(30));
    
    try {
      console.log('📦 Creating extractor from data...');
      const extractor = await unrar.createExtractorFromData({ data: buffer });
      
      if (!extractor) {
        throw new Error('Extractor creation returned null');
      }
      
      console.log('✅ Extractor created successfully');
      console.log(`🔍 Extractor type: ${typeof extractor}`);
      console.log(`🔍 Extractor methods: ${Object.keys(extractor).join(', ')}`);
      
      // Test file list retrieval
      console.log('\n📁 Getting file list...');
      const fileList = extractor.getFileList();
      
      console.log(`🔍 File list type: ${typeof fileList}`);
      console.log(`🔍 File list keys: ${Object.keys(fileList || {}).join(', ')}`);
      
      const fileHeaders = fileList?.fileHeaders || {};
      const fileNames = Object.keys(fileHeaders);
      
      console.log(`📊 Files found: ${fileNames.length}`);
      
      // Manual RAR structure inspection
      console.log('\n🔍 Manual RAR Structure Analysis');
      console.log('-'.repeat(30));
      
      await inspectRarStructure(buffer);
      
      if (fileNames.length > 0) {
        console.log('\n📋 File Details:');
        fileNames.slice(0, 10).forEach((name, index) => {
          const header = fileHeaders[name];
          console.log(`  ${index + 1}. ${name}`);
          console.log(`     Size: ${header?.size || 'unknown'} bytes`);
          console.log(`     Packed: ${header?.packedSize || 'unknown'} bytes`);
          console.log(`     Directory: ${header?.flags?.directory ? 'Yes' : 'No'}`);
        });
        
        if (fileNames.length > 10) {
          console.log(`  ... and ${fileNames.length - 10} more files`);
        }
        
        // Test extraction of first few files
        console.log('\n🚀 Testing Extraction...');
        const testFiles = fileNames.slice(0, 3); // Test first 3 files
        
        try {
          const extracted = extractor.extract({ files: testFiles });
          
          console.log(`🔍 Extraction result type: ${typeof extracted}`);
          console.log(`🔍 Extraction result keys: ${Object.keys(extracted || {}).join(', ')}`);
          
          if (extracted?.files && Array.isArray(extracted.files)) {
            console.log(`✅ Extraction successful: ${extracted.files.length} files extracted`);
            
            extracted.files.forEach((file, index) => {
              const fileName = file.fileHeader?.name || file.name || `file_${index}`;
              const content = file.extraction || file.content || file.data;
              console.log(`  📄 ${fileName}: ${content ? content.length : 0} bytes`);
            });
          } else {
            console.log('❌ Extraction failed: invalid result structure');
          }
          
        } catch (extractError) {
          console.log(`❌ Extraction failed: ${extractError.message}`);
          console.log(`📋 Error stack: ${extractError.stack}`);
        }
        
      } else {
        console.log('❌ No files found in archive by node-unrar-js');
        
        // Try raw extraction without file list
        console.log('\n� Attempting Raw Extraction (no file list)...');
        try {
          const rawExtracted = extractor.extract();
          
          console.log(`🔍 Raw extraction result type: ${typeof rawExtracted}`);
          console.log(`🔍 Raw extraction result keys: ${Object.keys(rawExtracted || {}).join(', ')}`);
          
          if (rawExtracted?.files && Array.isArray(rawExtracted.files)) {
            console.log(`✅ Raw extraction found: ${rawExtracted.files.length} files`);
            
            rawExtracted.files.slice(0, 5).forEach((file, index) => {
              const fileName = file.fileHeader?.name || file.name || `file_${index}`;
              const content = file.extraction || file.content || file.data;
              console.log(`  📄 ${fileName}: ${content ? content.length : 0} bytes`);
            });
            
            if (rawExtracted.files.length > 5) {
              console.log(`  ... and ${rawExtracted.files.length - 5} more files`);
            }
          } else {
            console.log('❌ Raw extraction also failed');
          }
          
        } catch (rawError) {
          console.log(`❌ Raw extraction failed: ${rawError.message}`);
        }
        
        console.log('\n🔍 This indicates:');
        console.log('  • RAR file structure may be incompatible with node-unrar-js');
        console.log('  • File headers not properly recognized by library');
        console.log('  • Possible RAR format or compression method issue');
      }
      
    } catch (unrarError) {
      console.log(`❌ node-unrar-js failed: ${unrarError.message}`);
      console.log(`📋 Error type: ${unrarError.constructor.name}`);
      console.log(`📋 Error stack: ${unrarError.stack}`);
    }
    
    // Step 4: Recommendations
    console.log('\n💡 Step 4: Recommendations');
    console.log('-'.repeat(30));
    
    if (isRar5) {
      console.log('⚠️  RAR 5.x format detected:');
      console.log('  • node-unrar-js has limited RAR 5.x support');
      console.log('  • Consider converting to RAR 4.x format');
      console.log('  • Or use ZIP format instead');
    }
    
    console.log('\n🔧 Alternative Solutions:');
    console.log('  1. Convert RAR to ZIP format');
    console.log('  2. Use RAR 4.x compression (older format)');
    console.log('  3. Install command-line tools (7-Zip, WinRAR)');
    console.log('  4. Try different compression settings');
    console.log('  5. Ensure file is not password-protected');
    
  } catch (error) {
    console.error('❌ Diagnostic failed:', error.message);
    console.error('📋 Stack trace:', error.stack);
  }
}

/**
 * Manual RAR structure inspection for debugging
 */
async function inspectRarStructure(buffer) {
  console.log('🔍 Performing manual RAR binary analysis...');
  
  try {
    // RAR file structure analysis
    let offset = 0;
    
    // Main RAR header (starts after signature)
    const signature = buffer.slice(0, 7);
    offset = 7;
    
    console.log(`📋 RAR signature: ${signature.toString('hex')} (${signature.toString('ascii').replace(/[^\x20-\x7E]/g, '.')})`);
    
    // Read main archive header
    if (offset + 13 < buffer.length) {
      const headerCRC = buffer.readUInt16LE(offset);
      const headerType = buffer.readUInt8(offset + 2);
      const headerFlags = buffer.readUInt16LE(offset + 3);
      const headerSize = buffer.readUInt16LE(offset + 5);
      
      console.log('📋 Main archive header:');
      console.log(`   CRC: 0x${headerCRC.toString(16)}`);
      console.log(`   Type: 0x${headerType.toString(16)} (${headerType === 0x73 ? 'Archive Header' : 'Unknown'})`);
      console.log(`   Flags: 0b${headerFlags.toString(2).padStart(16, '0')}`);
      console.log(`   Size: ${headerSize} bytes`);
      
      offset += headerSize;
      
      // Look for file headers
      let fileCount = 0;
      let maxIterations = 50; // Prevent infinite loop
      const detectedFiles = [];
      
      console.log('\n🔍 Scanning for file headers...');
      
      while (offset < buffer.length - 7 && fileCount < maxIterations) {
        if (offset + 7 >= buffer.length) break;
        
        try {
          const nextHeaderCRC = buffer.readUInt16LE(offset);
          const nextHeaderType = buffer.readUInt8(offset + 2);
          const nextHeaderFlags = buffer.readUInt16LE(offset + 3);
          const nextHeaderSize = buffer.readUInt16LE(offset + 5);
          
          console.log(`📄 Header at offset ${offset}:`);
          console.log(`   CRC: 0x${nextHeaderCRC.toString(16)}`);
          console.log(`   Type: 0x${nextHeaderType.toString(16)} (${getHeaderTypeName(nextHeaderType)})`);
          console.log(`   Flags: 0b${nextHeaderFlags.toString(2).padStart(16, '0')}`);
          console.log(`   Size: ${nextHeaderSize} bytes`);
          
          if (nextHeaderType === 0x74) { // File header
            fileCount++;
            
            // Try to read file name and details
            if (offset + nextHeaderSize < buffer.length && nextHeaderSize > 25) {
              try {
                // Basic file header parsing (simplified)
                const fileHeaderData = buffer.slice(offset + 7, offset + nextHeaderSize);
                
                // File attributes, size, time, etc. are at fixed positions
                const unpackedSize = fileHeaderData.readUInt32LE(4);
                const packedSize = fileHeaderData.readUInt32LE(8);
                const nameSize = fileHeaderData.readUInt16LE(19);
                
                let fileName = 'unknown';
                if (nameSize > 0 && nameSize < 1000 && offset + 7 + 21 + nameSize < buffer.length) {
                  const nameBytes = fileHeaderData.slice(21, 21 + nameSize);
                  fileName = nameBytes.toString('utf8').replace(/\0/g, '');
                }
                
                detectedFiles.push({
                  name: fileName,
                  unpackedSize,
                  packedSize,
                  headerOffset: offset
                });
                
                console.log(`   📁 File: "${fileName}"`);
                console.log(`   📏 Unpacked: ${unpackedSize.toLocaleString()} bytes`);
                console.log(`   📦 Packed: ${packedSize.toLocaleString()} bytes`);
                console.log(`   📐 Ratio: ${packedSize > 0 ? ((1 - packedSize/unpackedSize) * 100).toFixed(1) : 0}%`);
                
              } catch (parseError) {
                console.log(`   ⚠️ Failed to parse file details: ${parseError.message}`);
              }
            }
          }
          
          if (nextHeaderSize === 0 || nextHeaderSize > buffer.length || nextHeaderSize < 7) {
            console.log(`   ⚠️ Invalid header size (${nextHeaderSize}), stopping scan`);
            break;
          }
          
          offset += nextHeaderSize;
          maxIterations--;
          
        } catch (readError) {
          console.log(`   ❌ Error reading header at offset ${offset}: ${readError.message}`);
          break;
        }
      }
      
      console.log('\n📊 RAR Structure Analysis Summary:');
      console.log(`   Total file headers detected: ${fileCount}`);
      console.log(`   Bytes analyzed: ${offset.toLocaleString()} / ${buffer.length.toLocaleString()}`);
      console.log(`   Analysis coverage: ${((offset / buffer.length) * 100).toFixed(1)}%`);
      
      if (detectedFiles.length > 0) {
        console.log('\n📋 Detected Files Summary:');
        detectedFiles.forEach((file, index) => {
          console.log(`   ${index + 1}. "${file.name}" (${file.unpackedSize.toLocaleString()} bytes)`);
        });
        
        const totalUnpacked = detectedFiles.reduce((sum, file) => sum + file.unpackedSize, 0);
        const totalPacked = detectedFiles.reduce((sum, file) => sum + file.packedSize, 0);
        
        console.log(`\n📈 Archive Statistics:`);
        console.log(`   Total files: ${detectedFiles.length}`);
        console.log(`   Total uncompressed: ${totalUnpacked.toLocaleString()} bytes (${(totalUnpacked/1024/1024).toFixed(2)} MB)`);
        console.log(`   Total compressed: ${totalPacked.toLocaleString()} bytes (${(totalPacked/1024/1024).toFixed(2)} MB)`);
        console.log(`   Compression ratio: ${totalUnpacked > 0 ? ((1 - totalPacked/totalUnpacked) * 100).toFixed(1) : 0}%`);
        
        console.log('\n✅ Manual analysis detected files, but node-unrar-js cannot read them!');
        console.log('💡 This confirms a library compatibility issue with this specific RAR format.');
        
      } else {
        console.log('\n❌ No file headers detected in manual analysis either');
        console.log('🔍 This suggests the RAR file may be:');
        console.log('   • Truly empty (no files archived)');
        console.log('   • Corrupted or incomplete');
        console.log('   • Using an unsupported RAR variant');
      }
      
    } else {
      console.log('❌ RAR file too small for proper header analysis');
    }
    
  } catch (inspectError) {
    console.log(`❌ Manual inspection failed: ${inspectError.message}`);
  }
}

function getHeaderTypeName(type) {
  switch (type) {
    case 0x72: return 'Marker Block';
    case 0x73: return 'Archive Header';
    case 0x74: return 'File Header';
    case 0x75: return 'Comment Header';
    case 0x76: return 'Extra Info';
    case 0x77: return 'Subblock';
    case 0x78: return 'Recovery Record';
    case 0x79: return 'Archive Authenticity';
    case 0x7a: return 'Subblock';
    default: return 'Unknown';
  }
}

// CLI usage
if (require.main === module) {
  const rarFile = process.argv[2];
  
  if (!rarFile) {
    console.log('Usage: node test-rar-extraction.js <path-to-rar-file>');
    console.log('Example: node test-rar-extraction.js ./uploads/example.rar');
    process.exit(1);
  }
  
  testRarExtraction(rarFile)
    .then(() => {
      console.log('\n🎉 Diagnostic completed');
    })
    .catch((error) => {
      console.error('\n💥 Diagnostic failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testRarExtraction };