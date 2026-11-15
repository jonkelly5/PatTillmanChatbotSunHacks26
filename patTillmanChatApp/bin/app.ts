import * as cdk from 'aws-cdk-lib';
import { PatTillmanChatStack } from '../lib/patTillmanChat-stack';

const app = new cdk.App();
new PatTillmanChatStack(app, 'PatTillmanChatStack', {
  env: { account: '{AWS-Account-id}', region: 'us-west-2' },
});
