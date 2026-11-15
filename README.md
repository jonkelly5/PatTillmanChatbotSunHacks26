# Website link

https://dxgtsdlm6avj2.cloudfront.net (Active until Nov 21st 2026)

# Getting started

1. Create AWS account and IAM user
   - https://docs.aws.amazon.com/cli/v1/userguide/cli-authentication-user.html
2. Configure access keys in your terminal with `aws configure`
3. Clone this git repo to your local
4. Go into the code directory `cd PatTillmanChatbotSunHacks26/patTillmanChatApppatTillmanChatApp/`
5. In bin/app.ts replace {AWS-Account-id} with your accountId 
6. `npm install`
7. `cdk bootstrap`
8. `cdk deploy`
 - Confirm the infrstrucutre changes with "Y"
 - This will take 5-10 minutes to deploy
9. Add the .txt files from the Name	KnowedgeBaseText folder to the pattillmanchatstack-documentsbucket S3 bucket

# Testing

Run `curl -X POST {API-Gateway-Invoke-URL}/ask  -H "Content-Type: application/json" -d '{"question": "When did Pat Tillman leave the NFL?"}'` in your terminal
- Get your {API-Gateway-Invoke-URL} from the console in APIGateway -> Deploy -> Stages

Vist https://{CloudfrontDistrbution Domain Id}.cloudfront.net
- Get your CloudfrontDistrbution domain name from the console in Cloudfront -> Distribution -> your distribution -> Distribution domain name

# Debugging

If deployment fails check the "PatTillmanChatStack" stack in cloudformation via the aws console (website)
