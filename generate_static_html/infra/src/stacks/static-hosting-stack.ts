import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Construct } from "constructs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BatteryStaticHostingStackProps extends cdk.StackProps {
  /** Custom domain name (e.g. "baterie.twojafirma.pl"). Optional. */
  domainName?: string;
  /** Route53 Hosted Zone ID for the domain. Required if domainName is set. */
  hostedZoneId?: string;
  /** ACM certificate ARN (must be in us-east-1 for CloudFront). Required if domainName is set. */
  certificateArn?: string;
  /** Explicit S3 bucket name. Optional — CDK will generate a unique name if omitted. */
  bucketName?: string;
}

export class BatteryStaticHostingStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: BatteryStaticHostingStackProps) {
    super(scope, id, props);

    // ────────────────────────────────────────────
    // 1. S3 Bucket — private, versioned, encrypted
    // ────────────────────────────────────────────
    this.bucket = new s3.Bucket(this, "BatteryPagesBucket", {
      bucketName: props.bucketName,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // nie kasuj bucketu przy cdk destroy
      lifecycleRules: [
        {
          // Stare wersje plików — przenieś do tańszego storage po 30 dniach
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          // Usuń stare wersje po 365 dniach
          noncurrentVersionExpiration: cdk.Duration.days(365),
        },
      ],
    });

    // ────────────────────────────────────────────
    // 2. CloudFront — OAC, HTTPS, cache policy
    // ────────────────────────────────────────────

    // Cache policy: agresywne cachowanie (strony się nie zmieniają po wygenerowaniu)
    const cachePolicy = new cloudfront.CachePolicy(this, "BatteryCachePolicy", {
      cachePolicyName: `BatteryStaticCache-${this.stackName}`,
      comment: "Long-lived cache for static battery info pages",
      defaultTtl: cdk.Duration.days(365),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // Response headers policy: security + archival headers
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "BatteryResponseHeaders", {
      responseHeadersPolicyName: `BatteryHeaders-${this.stackName}`,
      comment: "Security and archival headers for battery pages",
      securityHeadersBehavior: {
        contentTypeOptions: { override: true }, // X-Content-Type-Options: nosniff
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: "Cache-Control",
            value: "public, max-age=31536000, immutable",
            override: false,
          },
        ],
      },
    });

    // Opcjonalnie: custom domain + certyfikat
    let certificate: acm.ICertificate | undefined;
    let domainNames: string[] | undefined;

    if (props.domainName && props.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(
        this, "Certificate", props.certificateArn
      );
      domainNames = [props.domainName];
    }

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, "BatteryDistribution", {
      comment: "Battery Info Static Pages",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy,
        responseHeadersPolicy,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
      },
      // Strona błędu 404 → czytelny komunikat
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: cdk.Duration.minutes(5),
        },
      ],
      certificate,
      domainNames,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Europa + Ameryka Płn.
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // ────────────────────────────────────────────
    // 3. Route53 — DNS alias (jeśli domena podana)
    // ────────────────────────────────────────────
    if (props.domainName && props.hostedZoneId) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName.split(".").slice(-2).join("."),
      });

      new route53.ARecord(this, "AliasRecord", {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new route53targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // ────────────────────────────────────────────
    // 4. DynamoDB — battery data storage
    // ────────────────────────────────────────────
    const table = new dynamodb.Table(this, "BatteriesTable", {
      tableName: `${this.stackName}-batteries`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    // ────────────────────────────────────────────
    // 5. Upload templates to S3 (_templates/ prefix)
    //    Build Lambda reads these at runtime.
    // ────────────────────────────────────────────
    const projectRoot = path.join(__dirname, "../../..");

    // Upload HTML templates
    new s3deploy.BucketDeployment(this, "TemplateDeployment", {
      sources: [
        s3deploy.Source.asset(projectRoot, {
          exclude: [
            "**",
            "!index.template.html",
            "!instructions-safety.template.html",
          ],
        }),
      ],
      destinationBucket: this.bucket,
      destinationKeyPrefix: "_templates/",
      prune: false,
      memoryLimit: 256,
    });

    // Upload assets (CSS, JS, SVG)
    new s3deploy.BucketDeployment(this, "AssetDeployment", {
      sources: [
        s3deploy.Source.asset(path.join(projectRoot, "assets"), {
          exclude: ["*.map"],
        }),
      ],
      destinationBucket: this.bucket,
      destinationKeyPrefix: "_templates/assets/",
      prune: false,
      memoryLimit: 256,
    });

    // ────────────────────────────────────────────
    // 6. Lambda — CRUD function
    // ────────────────────────────────────────────
    const lambdaDir = path.join(__dirname, "../../lambda");

    const crudFunction = new lambda.Function(this, "CrudFunction", {
      functionName: `${this.stackName}-crud`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(lambdaDir, "crud")),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        NODE_OPTIONS: "--enable-source-maps",
      },
      description: "Battery CRUD operations (DynamoDB)",
    });

    table.grantReadWriteData(crudFunction);

    // ────────────────────────────────────────────
    // 7. Lambda — Build + Publish function
    // ────────────────────────────────────────────
    const buildFunction = new nodejs.NodejsFunction(this, "BuildFunction", {
      functionName: `${this.stackName}-build`,
      entry: path.join(lambdaDir, "build", "index.mjs"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        mainFields: ["module", "main"],
        externalModules: [
          "@aws-sdk/client-dynamodb",
          "@aws-sdk/lib-dynamodb",
          "@aws-sdk/client-s3",
          "@aws-sdk/client-cloudfront",
        ],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: this.bucket.bucketName,
        DISTRIBUTION_ID: this.distribution.distributionId,
        TEMPLATES_PREFIX: "_templates/",
        CLOUDFRONT_DOMAIN: props.domainName || this.distribution.distributionDomainName,
        NODE_OPTIONS: "--enable-source-maps",
      },
      description: "Build HTML pages and publish to S3",
    });

    table.grantReadWriteData(buildFunction);
    this.bucket.grantReadWrite(buildFunction);

    // Grant CloudFront invalidation permission
    buildFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
        ],
      })
    );

    // ────────────────────────────────────────────
    // 8. Cognito — User Pool + App Client
    // ────────────────────────────────────────────
    // Custom Auth triggers Lambda (service password)
    const authTriggersFunction = new lambda.Function(this, "AuthTriggersFunction", {
      functionName: `${this.stackName}-auth-triggers`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(lambdaDir, "auth-triggers")),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      description: "Custom Auth Challenge triggers (service password) — TEMPORARY",
    });

    // PostAuthentication trigger Lambda (tracks last login)
    const postAuthFunction = new lambda.Function(this, "PostAuthFunction", {
      functionName: `${this.stackName}-post-auth`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(lambdaDir, "post-auth")),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      environment: {
        TABLE_NAME: table.tableName,
      },
      description: "PostAuthentication trigger — saves last login timestamp to DynamoDB",
    });
    table.grantWriteData(postAuthFunction);

    const userPool = new cognito.UserPool(this, "AdminUserPool", {
      userPoolName: `${this.stackName}-admins`,
      selfSignUpEnabled: false, // Only admin can create users
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        tenantId: new cognito.StringAttribute({ mutable: true }),
      },
      lambdaTriggers: {
        defineAuthChallenge: authTriggersFunction,
        createAuthChallenge: authTriggersFunction,
        verifyAuthChallengeResponse: authTriggersFunction,
        postAuthentication: postAuthFunction,
      },
    });

    // Cognito Group: superadmin
    new cognito.CfnUserPoolGroup(this, "SuperAdminGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "superadmin",
      description: "Platform administrators — can manage all tenants",
    });

    const userPoolClient = userPool.addClient("AdminClient", {
      userPoolClientName: `${this.stackName}-admin-client`,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
      generateSecret: false, // SPA client — no secret
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // ────────────────────────────────────────────
    // 9. API Gateway — REST API with Cognito auth
    // ────────────────────────────────────────────
    const api = new apigateway.RestApi(this, "BatteryApi", {
      restApiName: "Battery Info API",
      description: "API for managing battery data and publishing static pages",
      deployOptions: {
        stageName: "v1",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Api-Key",
          "X-Tenant-Id",
        ],
      },
    });

    // Cognito authorizer
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "CognitoAuth", {
      cognitoUserPools: [userPool],
      authorizerName: `${this.stackName}-cognito-auth`,
      identitySource: "method.request.header.Authorization",
    });

    const cognitoMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // Also keep API Key as fallback for programmatic/CI access
    const apiKey = api.addApiKey("BatteryApiKey", {
      apiKeyName: `${this.stackName}-api-key`,
      description: "API key for programmatic/CI access",
    });

    const usagePlan = api.addUsagePlan("BatteryUsagePlan", {
      name: `${this.stackName}-usage-plan`,
      throttle: { rateLimit: 100, burstLimit: 50 },
      quota: { limit: 10000, period: apigateway.Period.DAY },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });

    // ────────────────────────────────────────────
    // 9b. Lambda — Tenant management (Cognito admin ops)
    // ────────────────────────────────────────────
    const tenantFunction = new lambda.Function(this, "TenantFunction", {
      functionName: `${this.stackName}-tenants`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(lambdaDir, "tenants")),
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        USER_POOL_ID: userPool.userPoolId,
        NODE_OPTIONS: "--enable-source-maps",
      },
      description: "Tenant management (create/list tenants, manage tenant users)",
    });

    table.grantReadWriteData(tenantFunction);

    // Grant Cognito admin permissions to tenant Lambda
    tenantFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:ListUsersInGroup",
          "cognito-idp:ListUsers",
        ],
        resources: [userPool.userPoolArn],
      })
    );

    // Routes — Cognito auth (admin panel uses these)
    const crudIntegration = new apigateway.LambdaIntegration(crudFunction);
    const buildIntegration = new apigateway.LambdaIntegration(buildFunction);
    const tenantIntegration = new apigateway.LambdaIntegration(tenantFunction);

    // /batteries
    const batteries = api.root.addResource("batteries");
    batteries.addMethod("GET", crudIntegration, cognitoMethodOptions);
    batteries.addMethod("POST", crudIntegration, cognitoMethodOptions);

    // /batteries/{code}
    const battery = batteries.addResource("{code}");
    battery.addMethod("GET", crudIntegration, cognitoMethodOptions);
    battery.addMethod("PUT", crudIntegration, cognitoMethodOptions);
    battery.addMethod("DELETE", crudIntegration, cognitoMethodOptions);

    // /batteries/{code}/publish
    const publish = battery.addResource("publish");
    publish.addMethod("POST", buildIntegration, cognitoMethodOptions);

    // /tenants (superadmin only — enforced in Lambda)
    const tenants = api.root.addResource("tenants");
    tenants.addMethod("GET", tenantIntegration, cognitoMethodOptions);
    tenants.addMethod("POST", tenantIntegration, cognitoMethodOptions);

    // /tenants/{tenantId}
    const tenant = tenants.addResource("{tenantId}");
    tenant.addMethod("GET", tenantIntegration, cognitoMethodOptions);
    tenant.addMethod("PUT", tenantIntegration, cognitoMethodOptions);
    tenant.addMethod("DELETE", tenantIntegration, cognitoMethodOptions);

    // /tenants/{tenantId}/users
    const tenantUsers = tenant.addResource("users");
    tenantUsers.addMethod("GET", tenantIntegration, cognitoMethodOptions);
    tenantUsers.addMethod("POST", tenantIntegration, cognitoMethodOptions);

    // /tenants/{tenantId}/users/{userId}
    const tenantUser = tenantUsers.addResource("{userId}");
    tenantUser.addMethod("DELETE", tenantIntegration, cognitoMethodOptions);

    // ────────────────────────────────────────────
    // 10. Admin Panel — deploy SPA to S3
    // ────────────────────────────────────────────
    const adminDir = path.join(projectRoot, "admin");

    new s3deploy.BucketDeployment(this, "AdminPanelDeployment", {
      sources: [
        s3deploy.Source.asset(adminDir),
      ],
      destinationBucket: this.bucket,
      destinationKeyPrefix: "_admin/",
      prune: false,
      memoryLimit: 256,
    });

    // ────────────────────────────────────────────
    // 11. Outputs
    // ────────────────────────────────────────────
    new cdk.CfnOutput(this, "BucketName", {
      value: this.bucket.bucketName,
      description: "S3 bucket for battery HTML pages",
      exportName: "BatteryBucketName",
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront distribution ID (for cache invalidation)",
      exportName: "BatteryDistributionId",
    });

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: this.distribution.distributionDomainName,
      description: "CloudFront domain (use this URL if no custom domain)",
      exportName: "BatteryDistributionDomain",
    });

    new cdk.CfnOutput(this, "TableName", {
      value: table.tableName,
      description: "DynamoDB table for battery data",
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway base URL",
    });

    new cdk.CfnOutput(this, "ApiKeyId", {
      value: apiKey.keyId,
      description: "API Key ID (for programmatic access)",
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
      description: "Cognito App Client ID (for admin panel)",
    });

    new cdk.CfnOutput(this, "AdminPanelUrl", {
      value: props.domainName
        ? `https://${props.domainName}/_admin/index.html`
        : `https://${this.distribution.distributionDomainName}/_admin/index.html`,
      description: "Admin panel URL",
    });

    if (props.domainName) {
      new cdk.CfnOutput(this, "CustomDomain", {
        value: `https://${props.domainName}`,
        description: "Custom domain URL",
      });
    }

    new cdk.CfnOutput(this, "ExamplePageUrl", {
      value: props.domainName
        ? `https://${props.domainName}/b/abc123/index.html`
        : `https://${this.distribution.distributionDomainName}/b/abc123/index.html`,
      description: "Example battery page URL (after upload)",
    });
  }
}
