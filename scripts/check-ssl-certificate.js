require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS ACM (Certificate Manager)
const acm = new AWS.ACM({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: 'us-east-1' // ACM certificates for CloudFront must be in us-east-1
});

async function checkSSLCertificate() {
  try {
    console.log('🔍 Checking SSL certificates for junotech.in...\n');
    
    const result = await acm.listCertificates().promise();
    
    const junotechCerts = result.CertificateSummaryList.filter(cert => 
      cert.DomainName === 'junotech.in' || 
      cert.DomainName === '*.junotech.in' ||
      cert.SubjectAlternativeNameSummary?.includes('*.junotech.in') ||
      cert.SubjectAlternativeNameSummary?.includes('junotech.in')
    );
    
    if (junotechCerts.length > 0) {
      console.log('✅ Found SSL certificates for junotech.in:\n');
      
      for (const cert of junotechCerts) {
        console.log(`Certificate ARN: ${cert.CertificateArn}`);
        console.log(`Domain: ${cert.DomainName}`);
        console.log(`Status: ${cert.Status}`);
        console.log(`Type: ${cert.Type}`);
        
        if (cert.SubjectAlternativeNameSummary) {
          console.log(`Alternative Names: ${cert.SubjectAlternativeNameSummary.join(', ')}`);
        }
        
        // Get detailed information
        try {
          const details = await acm.describeCertificate({
            CertificateArn: cert.CertificateArn
          }).promise();
          
          const certificate = details.Certificate;
          console.log(`Validation Method: ${certificate.ValidationMethod || 'Unknown'}`);
          console.log(`Key Algorithm: ${certificate.KeyAlgorithm || 'Unknown'}`);
          console.log(`In Use: ${certificate.InUseBy?.length > 0 ? 'Yes' : 'No'}`);
          
          if (certificate.DomainValidationOptions) {
            console.log('Domain Validation Status:');
            certificate.DomainValidationOptions.forEach(domain => {
              console.log(`  - ${domain.DomainName}: ${domain.ValidationStatus}`);
            });
          }
          
        } catch (detailError) {
          console.log(`Error getting details: ${detailError.message}`);
        }
        
        console.log('---\n');
        
        // Check if this is a wildcard certificate that's validated
        if (cert.Status === 'ISSUED' && 
            (cert.DomainName === '*.junotech.in' || 
             cert.SubjectAlternativeNameSummary?.includes('*.junotech.in'))) {
          console.log('🎯 RECOMMENDED CERTIFICATE FOR CLOUDFRONT:');
          console.log(`SSL_CERTIFICATE_ARN=${cert.CertificateArn}\n`);
        }
      }
      
    } else {
      console.log('❌ No SSL certificates found for junotech.in');
      console.log('\n🔧 To create an SSL certificate:');
      console.log('1. Go to AWS Console > Certificate Manager (us-east-1 region)');
      console.log('2. Request a public certificate');
      console.log('3. Add domains: *.junotech.in and junotech.in');
      console.log('4. Use DNS validation');
      console.log('5. Add the validation CNAME records to Route 53');
    }
    
    console.log('\n📋 All certificates in us-east-1:');
    if (result.CertificateSummaryList.length > 0) {
      result.CertificateSummaryList.forEach(cert => {
        console.log(`   - ${cert.DomainName} (${cert.Status})`);
      });
    } else {
      console.log('   No certificates found');
    }
    
  } catch (error) {
    console.error('❌ Failed to check SSL certificates:', error.message);
    console.error('\nPossible issues:');
    console.error('   - AWS credentials not configured correctly');
    console.error('   - Missing ACM permissions');
    console.error('   - Wrong AWS region (must be us-east-1 for CloudFront)');
  }
}

checkSSLCertificate();