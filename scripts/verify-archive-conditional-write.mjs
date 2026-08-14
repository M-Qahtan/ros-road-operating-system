import { readFile } from 'node:fs/promises';

const archivePath = new URL('./archive-github-evidence.mjs', import.meta.url);
const terraformPath = new URL('../infrastructure/evidence-store/aws-frankfurt/main.tf', import.meta.url);

const [archive, terraform] = await Promise.all([
  readFile(archivePath, 'utf8'),
  readFile(terraformPath, 'utf8')
]);

function requireText(condition, code) {
  if (!condition) {
    console.error(`Archive conditional-write verification failed: ${code}`);
    process.exit(1);
  }
}

requireText(archive.includes("function conditionalUploadAndVerify("), 'CONDITIONAL_UPLOAD_HELPER');
requireText(archive.includes("'--if-none-match', '*'"), 'IF_NONE_MATCH_STAR');
requireText(/(?:\\b412\\b|PreconditionFailed|Precondition Failed)/u.test(archive), 'PRECONDITION_412_HANDLING');
requireText(archive.includes('const created = conditionalUploadAndVerify(params);'), 'ARTIFACT_CONDITIONAL_FIRST');
requireText(archive.includes('const existing = verifyExistingObject(params);'), 'ARTIFACT_VERIFY_AFTER_412');
requireText(archive.includes('const createdReceipt = conditionalUploadAndVerify({'), 'RECEIPT_CONDITIONAL_FIRST');
requireText(archive.includes('const existingReceipt = await loadExistingReceipt({'), 'RECEIPT_VERIFY_AFTER_412');
requireText(!archive.includes('return verifyExistingObject(params) ?? uploadAndVerify(params);'), 'NO_HEAD_FIRST_UPLOAD');
requireText(!archive.includes('function uploadAndVerify('), 'NO_UNCONDITIONAL_UPLOAD_HELPER');

const archiveStart = terraform.indexOf('data "aws_iam_policy_document" "archive" {');
const archiveEnd = terraform.indexOf('resource "aws_iam_role_policy" "github_archive" {');
requireText(archiveStart >= 0 && archiveEnd > archiveStart, 'ARCHIVE_IAM_SECTION');
const archivePolicy = terraform.slice(archiveStart, archiveEnd);
requireText(!archivePolicy.includes('"s3:ListBucket"'), 'ARCHIVE_NO_BUCKET_ENUMERATION');

console.log('Archive conditional S3 write PASS (create-if-absent + 412 reuse; no archive ListBucket expansion).');