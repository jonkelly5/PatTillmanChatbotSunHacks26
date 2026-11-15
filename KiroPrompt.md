# Pat Tillman Educational Q&A Application

## Goal
Build a serverless Q&A app with AWS CDK (TypeScript) that answers questions about Pat Tillman for Arizona State University students. Plain text documents in S3 are synced into an Amazon Bedrock Knowledge Base. A Lambda behind API Gateway calls the knowledge base's `RetrieveAndGenerate` API, which finds the relevant passages and has Claude answer from them.

## Architecture
```
User (HTTP POST) → API Gateway → Lambda → Bedrock RetrieveAndGenerate → Claude
                                                    ↑
                                    Knowledge Base (S3 Vectors index)
                                                    ↑ sync
                                       S3 Bucket (plain text documents)
```

## Requirements

### CDK Stack (single stack, us-west-2)
- **Documents bucket:** private S3 bucket, S3-managed encryption, versioning on.
- **Vector store:** S3 Vectors (`aws-cdk-lib/aws-s3vectors`) vector bucket and index, sized for Titan Text Embeddings V2.
- **Knowledge base** (`aws-cdk-lib/aws-bedrock` L1 constructs):
    - Uses Titan Text Embeddings V2 and the S3 Vectors index, with its own IAM role that can use the embedding model, the vector bucket and the documents bucket.
    - An S3 data source pointing at the documents bucket, with default chunking.
    - A custom resource that starts an ingestion job on first deploy.
- **Lambda** (Node.js 22.x, `NodejsFunction`, 30s timeout, 512 MB):
    - Environment variables for the knowledge base ID and the model ARN.
    - Permission to call `RetrieveAndGenerate` on the knowledge base and to invoke the Claude model.
- **API:** HTTP API (API Gateway v2) with a `POST /ask` route to the Lambda.
- **Outputs:** API URL, documents bucket name, knowledge base ID.

### Lambda Function
1. Read `question` from the JSON body. Return 400 if it's missing or invalid.
2. Call `RetrieveAndGenerate` with the knowledge base and model, using a custom prompt template: answer only from the search results, use exact numbers, dates and facts, and say "I don't know" if the answer isn't there. Use temperature 0.
3. Return `{ "answer": "..." }`. Return 500 on errors. Include an `Access-Control-Allow-Origin: *` header.

### Technical Notes (things that break if missed)
- **No Bedrock Agent.** Bedrock Agents is in maintenance mode and new accounts get "Access denied" when creating one. Use the knowledge base API directly.
- **Use S3 Vectors, not OpenSearch Serverless.** OpenSearch is slow to provision and costs about $175/month minimum.
- **Vector index metadata:** mark `AMAZON_BEDROCK_TEXT` and `AMAZON_BEDROCK_METADATA` as non-filterable metadata keys, or ingestion fails on chunk size.
- **Model:** use the inference profile `us.anthropic.claude-haiku-4-5-20251001-v1:0`, passed to `RetrieveAndGenerate` as a full inference profile ARN. The Lambda needs `bedrock:InvokeModel` and `bedrock:GetInferenceProfile` on both foundation-model and inference-profile ARNs, or the call fails with AccessDenied.
- **Bundling:** `@aws-sdk/client-bedrock-agent-runtime` is in the Lambda runtime, so mark it external and add it as a devDependency for types. Add `esbuild` as a devDependency so bundling doesn't need Docker.
- **Account setup:** run `cdk bootstrap` if the region isn't bootstrapped, and make sure Titan Text Embeddings V2 and Claude Haiku 4.5 are enabled in Bedrock model access.

## Project Structure
```
patTillmanChatApp/
├── bin/app.ts                  # CDK app entrypoint
├── lib/patTillmanChat-stack.ts # Single CDK stack
├── lambda/ask.ts               # Lambda handler
├── cdk.json
├── tsconfig.json
└── package.json
```

## Testing
1. Upload the documents: `aws s3 cp knowledgeBaseText/ s3://<bucket-name>/ --recursive`
2. Sync the knowledge base (console **Sync**, or `aws bedrock-agent start-ingestion-job`) and wait for it to finish. The deploy-time ingestion runs before the documents are uploaded, and the knowledge base only sees documents as of its last sync.
3. Test: `curl -X POST <api-url>/ask -H "Content-Type: application/json" -d '{"question": "What team did Pat Tillman play for in the NFL?"}'`

## Additional Notes
This is an educational app, so prioritize simple code and moving fast over production-level security and maintainability.

Deploy to AWS account 115512263232 in us-west-2.

If any instructions are unclear, stop and ask for clarification before proceeding.
