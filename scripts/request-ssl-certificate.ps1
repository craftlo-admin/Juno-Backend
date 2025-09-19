# SSL Certificate Request Script for *.junotech.in (PowerShell)
# This script requests a wildcard SSL certificate from AWS Certificate Manager

Write-Host "🔐 Requesting SSL Certificate for *.junotech.in" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Check if AWS CLI is installed
try {
    aws --version | Out-Null
    Write-Host "✅ AWS CLI found" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS CLI not found. Please install AWS CLI first." -ForegroundColor Red
    Write-Host "   Download from: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Check AWS credentials
Write-Host "📋 Checking AWS credentials..." -ForegroundColor Yellow
try {
    aws sts get-caller-identity --output text | Out-Null
    Write-Host "✅ AWS credentials configured" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS credentials not configured." -ForegroundColor Red
    Write-Host "   Run: aws configure" -ForegroundColor Yellow
    Write-Host "   Enter your AWS Access Key ID and Secret Access Key" -ForegroundColor Yellow
    exit 1
}

# Request the certificate
Write-Host "🎫 Requesting wildcard SSL certificate..." -ForegroundColor Yellow
Write-Host "   Domain: *.junotech.in" -ForegroundColor White
Write-Host "   Region: us-east-1 (required for CloudFront)" -ForegroundColor White
Write-Host "   Validation: DNS" -ForegroundColor White

try {
    $certArn = aws acm request-certificate `
        --domain-name "*.junotech.in" `
        --subject-alternative-names "junotech.in" `
        --validation-method DNS `
        --region us-east-1 `
        --query 'CertificateArn' `
        --output text

    if ($certArn) {
        Write-Host "✅ Certificate requested successfully!" -ForegroundColor Green
        Write-Host "📋 Certificate ARN: $certArn" -ForegroundColor Cyan
        Write-Host ""
        
        Write-Host "🔍 Getting validation records..." -ForegroundColor Yellow
        
        # Wait a moment for AWS to generate validation records
        Start-Sleep -Seconds 5
        
        # Get validation records
        Write-Host "📝 VALIDATION RECORDS TO ADD TO HOSTINGER:" -ForegroundColor Cyan
        Write-Host "===========================================" -ForegroundColor Cyan
        
        aws acm describe-certificate `
            --certificate-arn "$certArn" `
            --region us-east-1 `
            --query 'Certificate.DomainValidationOptions[].ResourceRecord' `
            --output table
        
        Write-Host ""
        Write-Host "📝 NEXT STEPS:" -ForegroundColor Green
        Write-Host "==============" -ForegroundColor Green
        Write-Host "1. Copy the validation records above" -ForegroundColor White
        Write-Host "2. Login to Hostinger hPanel (hpanel.hostinger.com)" -ForegroundColor White
        Write-Host "3. Go to Domain Management → junotech.in → DNS Zone" -ForegroundColor White
        Write-Host "4. Add each CNAME record shown above" -ForegroundColor White
        Write-Host "5. Wait 5-10 minutes for validation" -ForegroundColor White
        Write-Host "6. Add this to your .env file:" -ForegroundColor White
        Write-Host "   SSL_CERTIFICATE_ARN=$certArn" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "🔄 To check validation status, run:" -ForegroundColor Cyan
        Write-Host "   aws acm describe-certificate --certificate-arn $certArn --region us-east-1" -ForegroundColor White
        
        # Save certificate ARN to file for reference
        $certArn | Out-File -FilePath "ssl-certificate-arn.txt" -Encoding UTF8
        Write-Host "💾 Certificate ARN saved to: ssl-certificate-arn.txt" -ForegroundColor Green
        
        # Also update .env file if it exists
        if (Test-Path ".env") {
            Write-Host "📝 Updating .env file..." -ForegroundColor Yellow
            
            $envContent = Get-Content ".env"
            $newEnvContent = @()
            $sslLineFound = $false
            
            foreach ($line in $envContent) {
                if ($line -match "^#?\s*SSL_CERTIFICATE_ARN=") {
                    $newEnvContent += "SSL_CERTIFICATE_ARN=$certArn"
                    $sslLineFound = $true
                } else {
                    $newEnvContent += $line
                }
            }
            
            if (-not $sslLineFound) {
                $newEnvContent += ""
                $newEnvContent += "# SSL Certificate ARN for *.junotech.in"
                $newEnvContent += "SSL_CERTIFICATE_ARN=$certArn"
            }
            
            $newEnvContent | Out-File -FilePath ".env" -Encoding UTF8
            Write-Host "✅ .env file updated with SSL_CERTIFICATE_ARN" -ForegroundColor Green
        }
        
    } else {
        Write-Host "❌ Failed to get Certificate ARN" -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host "❌ Failed to request certificate: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Please check your AWS permissions and try again" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "🎉 SSL Certificate request completed!" -ForegroundColor Green
Write-Host "📧 Check AWS Console for validation status: https://console.aws.amazon.com/acm/home?region=us-east-1" -ForegroundColor Cyan
Write-Host ""
Write-Host "⏳ WAITING FOR VALIDATION:" -ForegroundColor Yellow
Write-Host "1. Add the CNAME records to Hostinger DNS" -ForegroundColor White
Write-Host "2. Validation usually takes 5-10 minutes" -ForegroundColor White
Write-Host "3. Certificate status will change to 'Issued'" -ForegroundColor White
Write-Host "4. Then you can test your custom domain setup!" -ForegroundColor White