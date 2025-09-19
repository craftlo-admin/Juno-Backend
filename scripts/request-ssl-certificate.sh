#!/bin/bash

# SSL Certificate Request Script for *.junotech.in
# This script requests a wildcard SSL certificate from AWS Certificate Manager

echo "🔐 Requesting SSL Certificate for *.junotech.in"
echo "=================================================="

# Check if AWS CLI is configured
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI first."
    echo "   Download from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
echo "📋 Checking AWS credentials..."
aws sts get-caller-identity > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ AWS credentials not configured."
    echo "   Run: aws configure"
    echo "   Enter your AWS Access Key ID and Secret Access Key"
    exit 1
fi

echo "✅ AWS credentials configured"

# Request the certificate
echo "🎫 Requesting wildcard SSL certificate..."
echo "   Domain: *.junotech.in"
echo "   Region: us-east-1 (required for CloudFront)"
echo "   Validation: DNS"

CERT_ARN=$(aws acm request-certificate \
    --domain-name "*.junotech.in" \
    --subject-alternative-names "junotech.in" \
    --validation-method DNS \
    --region us-east-1 \
    --query 'CertificateArn' \
    --output text)

if [ $? -eq 0 ]; then
    echo "✅ Certificate requested successfully!"
    echo "📋 Certificate ARN: $CERT_ARN"
    echo ""
    echo "🔍 Getting validation records..."
    
    # Wait a moment for AWS to generate validation records
    sleep 5
    
    # Get validation records
    aws acm describe-certificate \
        --certificate-arn "$CERT_ARN" \
        --region us-east-1 \
        --query 'Certificate.DomainValidationOptions[].ResourceRecord' \
        --output table
    
    echo ""
    echo "📝 NEXT STEPS:"
    echo "=============="
    echo "1. Copy the validation records above"
    echo "2. Login to Hostinger hPanel"
    echo "3. Go to Domain Management → junotech.in → DNS Zone"
    echo "4. Add each CNAME record shown above"
    echo "5. Wait 5-10 minutes for validation"
    echo "6. Add this to your .env file:"
    echo "   SSL_CERTIFICATE_ARN=$CERT_ARN"
    echo ""
    echo "🔄 To check validation status, run:"
    echo "   aws acm describe-certificate --certificate-arn $CERT_ARN --region us-east-1"
    
    # Save certificate ARN to file for reference
    echo "$CERT_ARN" > ssl-certificate-arn.txt
    echo "💾 Certificate ARN saved to: ssl-certificate-arn.txt"
    
else
    echo "❌ Failed to request certificate"
    echo "Please check your AWS permissions and try again"
    exit 1
fi

echo ""
echo "🎉 SSL Certificate request completed!"
echo "📧 You should receive an email when validation is complete."