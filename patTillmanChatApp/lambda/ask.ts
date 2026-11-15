import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const client = new BedrockAgentRuntimeClient({});
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const reply = (statusCode: number, body: object): APIGatewayProxyResultV2 => ({
  statusCode, headers, body: JSON.stringify(body),
});

const PROMPT = `You are a helpful assistant answering questions about Pat Tillman for students.
Answer ONLY using the search results below. Use exact numbers, dates and facts as written.
If the answer is not in the search results, say "I don't know".

Search results:
$search_results$

Question: $query$`;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  let question: unknown;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : event.body ?? '';
    question = JSON.parse(raw).question;
  } catch {
    return reply(400, { error: 'Request body must be valid JSON' });
  }
  if (typeof question !== 'string' || !question.trim()) {
    return reply(400, { error: '"question" must be a non-empty string' });
  }

  try {
    const res = await client.send(new RetrieveAndGenerateCommand({
      input: { text: question },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID!,
          modelArn: process.env.MODEL_ARN!,
          generationConfiguration: {
            promptTemplate: { textPromptTemplate: PROMPT },
            inferenceConfig: { textInferenceConfig: { temperature: 0 } },
          },
        },
      },
    }));
    return reply(200, { answer: res.output?.text ?? "I don't know" });
  } catch (err) {
    console.error(err);
    return reply(500, { error: 'Failed to generate an answer' });
  }
};
