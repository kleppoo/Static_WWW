#!/usr/bin/env node
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { BatteryStaticHostingStack } from "./stacks/static-hosting-stack.js";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "eu-central-1",
};

new BatteryStaticHostingStack(app, "BatteryStaticHosting", {
  env,
  description: "S3 + CloudFront hosting for Battery Info static pages",

  // --- Konfiguracja (opcjonalna) ---
  // Jeśli masz domenę, ustaw w .env:
  //   DOMAIN_NAME=baterie.twojafirma.pl
  //   HOSTED_ZONE_ID=Z1234567890
  //   CERTIFICATE_ARN=arn:aws:acm:us-east-1:...:certificate/...
  domainName: process.env.DOMAIN_NAME,
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  certificateArn: process.env.CERTIFICATE_ARN,

  // Nazwa bucketu (opcjonalna, CDK wygeneruje unikalną jeśli pusta)
  bucketName: process.env.BUCKET_NAME,
});

app.synth();
