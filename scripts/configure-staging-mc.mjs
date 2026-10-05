// Run with already-assumed project AWS credentials. No credentials are written to disk.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../lambda/package.json', import.meta.url));
const { LambdaClient, GetFunctionConfigurationCommand, UpdateFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');
const { S3Client, GetBucketPolicyCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');
const { AutoScalingClient, PutScheduledUpdateGroupActionCommand } = require('@aws-sdk/client-auto-scaling');
const region = 'ap-northeast-2';
const distribution = 'E2F49Q71ZUM0G0';
const origin = 'https://d32nzk2gacfhag.cloudfront.net';
const functionName = 'Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging';
const account = JSON.parse(execFileSync('aws', ['sts', 'get-caller-identity', '--output', 'json'], { encoding: 'utf8' }));
if (account.Account !== '329599637774' || !account.Arn.includes(':assumed-role/Liu_Teng_Yu_Intern2026/')) throw new Error('Unexpected AWS identity');
if (!process.argv.includes('--apply')) {
  console.log('Dry run: grant MC static-prefix access, merge the MC origin into staging Lambda, enable staging autoscaling and continuous baseline schedules.');
  process.exit(0);
}
const lambda = new LambdaClient({ region });
const s3 = new S3Client({ region: 'ap-southeast-1' });
const asg = new AutoScalingClient({ region });
const addOrigin = (value) => [...new Set([...String(value || '').split(',').filter(Boolean), origin])].join(',');
for (const [name, changes] of [
  [functionName, { GPU_SCHEDULE_ENABLED: 'true', GPU_SCHEDULE_START_HOUR: '0', GPU_SCHEDULE_END_HOUR: '24' }],
  [`${functionName}-coordinator`, { MODEL_COORDINATOR_MODE: 'autoscale' }],
]) {
  const current = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name }));
  const variables = { ...current.Environment.Variables, ...changes };
  if (name === functionName) {
    variables.CORS_ORIGIN = addOrigin(variables.CORS_ORIGIN);
    variables.LIVE_AUTH_EXEMPT_ORIGINS = addOrigin(variables.LIVE_AUTH_EXEMPT_ORIGINS);
  }
  await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: name, RevisionId: current.RevisionId, Environment: { Variables: variables } }));
  console.log(`Updated ${name}: ${Object.keys(changes).join(', ')}${name === functionName ? ', MC CORS/auth origin' : ''}`);
}
const bucket = 'interns2026-small-projects-bucket-shared';
const currentPolicy = await s3.send(new GetBucketPolicyCommand({ Bucket: bucket }));
const policy = JSON.parse(currentPolicy.Policy);
policy.Statement = policy.Statement.filter((item) => item.Sid !== 'AllowStagingMcCloudFront');
policy.Statement.push({
  Sid: 'AllowStagingMcCloudFront', Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' },
  Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/echolect-staging/dist-mc/*`,
  Condition: { StringEquals: { 'AWS:SourceArn': `arn:aws:cloudfront::329599637774:distribution/${distribution}` } },
});
await s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }));
console.log('Granted this CloudFront distribution read access to the MC static prefix only.');
for (const [name, cron] of [['start', '0 7 * * *'], ['stop', '0 19 * * *']]) {
  await asg.send(new PutScheduledUpdateGroupActionCommand({
    AutoScalingGroupName: 'vcs-staging-gpu-inference', ScheduledActionName: `vcs-staging-daily-${name}`,
    Recurrence: cron, TimeZone: 'Asia/Singapore', MinSize: 1, MaxSize: 192,
  }));
}
console.log('Staging baseline schedules now preserve at least one worker; fixed gateway schedule is 00:00–24:00 SGT.');
