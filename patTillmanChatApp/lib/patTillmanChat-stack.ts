import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';

export class PatTillmanChatStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const embeddingModelArn = `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`;
    const profileId = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    const inferenceProfileArn = `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${profileId}`;

    // Documents
    const docsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Vector store (S3 Vectors)
    const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket');
    const vectorIndex = new s3vectors.CfnIndex(this, 'VectorIndex', {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      dataType: 'float32',
      dimension: 1024,
      distanceMetric: 'cosine',
      metadataConfiguration: {
        nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'],
      },
    });

    // Knowledge base role
    const kbRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    });
    kbRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'], resources: [embeddingModelArn],
    }));
    kbRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3vectors:*'],
      resources: [vectorBucket.attrVectorBucketArn, `${vectorBucket.attrVectorBucketArn}/*`],
    }));
    docsBucket.grantRead(kbRole);

    const kb = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: 'pat-tillman-kb',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: { embeddingModelArn },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: { indexArn: vectorIndex.attrIndexArn },
      },
    });
    kb.node.addDependency(kbRole);

    const dataSource = new bedrock.CfnDataSource(this, 'DataSource', {
      name: 'pat-tillman-docs',
      knowledgeBaseId: kb.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: { bucketArn: docsBucket.bucketArn },
      },
    });

    // Start ingestion on first deploy
    new cr.AwsCustomResource(this, 'InitialIngestion', {
      installLatestAwsSdk: false,
      onCreate: {
        service: 'BedrockAgent',
        action: 'startIngestionJob',
        parameters: {
          knowledgeBaseId: kb.attrKnowledgeBaseId,
          dataSourceId: dataSource.attrDataSourceId,
        },
        physicalResourceId: cr.PhysicalResourceId.of('initial-ingestion'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({
        actions: ['bedrock:StartIngestionJob'], resources: [kb.attrKnowledgeBaseArn],
      })]),
    });

    // Lambda
    const askFn = new nodejs.NodejsFunction(this, 'AskFunction', {
      entry: path.join(__dirname, '../lambda/ask.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        KNOWLEDGE_BASE_ID: kb.attrKnowledgeBaseId,
        MODEL_ARN: inferenceProfileArn,
      },
      bundling: { externalModules: ['@aws-sdk/client-bedrock-agent-runtime'] },
    });
    askFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:RetrieveAndGenerate', 'bedrock:Retrieve'],
      resources: [kb.attrKnowledgeBaseArn],
    }));
    askFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:GetInferenceProfile'],
      resources: [
        inferenceProfileArn,
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
      ],
    }));

    // API
    const api = new apigw.HttpApi(this, 'HttpApi', { apiName: 'pat-tillman-chat' });
    api.addRoutes({
      path: '/ask',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('AskIntegration', askFn),
    });

    // Static website behind CloudFront (also proxies /ask)
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/ask': {
          origin: new origins.HttpOrigin(`${api.apiId}.execute-api.${this.region}.amazonaws.com`),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
    });
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../website'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });
    new cdk.CfnOutput(this, 'WebsiteUrl', { value: `https://${distribution.distributionDomainName}` });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new cdk.CfnOutput(this, 'DocumentsBucketName', { value: docsBucket.bucketName });
    new cdk.CfnOutput(this, 'KnowledgeBaseId', { value: kb.attrKnowledgeBaseId });
  }
}
