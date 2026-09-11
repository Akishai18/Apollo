#!/bin/bash
# One-time setup for hosting the Apollo API on Lightsail Containers ($7/mo nano).
# Run in AWS CloudShell: upload via Actions -> Upload file, then:
#   bash aws-apollo-setup.sh
# Safe to re-run; "already exists" errors mean that step was previously done.
#
# At the end it prints the TWO values you need for GitHub:
#   - the deploy role ARN  -> repo variable AWS_DEPLOY_ROLE_ARN
#   - the service URL      -> Vercel NEXT_PUBLIC_API_URL (after first deploy)

set -u
export AWS_PAGER=""
REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
GH_REPO="Akishai18/Apollo"    # OIDC trust is pinned to this exact owner/name —
                              # if the GitHub repo is ever renamed, rerun step 2
SERVICE=apollo-api
REPO=apollo-api
ROLE=apollo-github-deploy

echo "=== 1/6 ECR repository (+ keep-last-5 lifecycle rule) ==="
aws ecr create-repository --repository-name $REPO --region $REGION
cat > /tmp/ecr-lifecycle.json <<'EOF'
{
  "rules": [{
    "rulePriority": 1,
    "description": "keep only the 5 most recent images",
    "selection": {
      "tagStatus": "any",
      "countType": "imageCountMoreThan",
      "countNumber": 5
    },
    "action": { "type": "expire" }
  }]
}
EOF
aws ecr put-lifecycle-policy --repository-name $REPO \
  --lifecycle-policy-text file:///tmp/ecr-lifecycle.json --region $REGION

echo "=== 2/6 GitHub OIDC deploy role ==="
# The account-wide OIDC provider already exists from the SignalM setup;
# "EntityAlreadyExists" here is expected and fine.
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com

cat > /tmp/deploy-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:${GH_REPO}:*" }
    }
  }]
}
EOF
cat > /tmp/deploy-permissions.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload", "ecr:PutImage"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lightsail:CreateContainerServiceDeployment",
        "lightsail:GetContainerServices",
        "lightsail:GetContainerServiceDeployments"
      ],
      "Resource": "*"
    }
  ]
}
EOF
aws iam create-role --role-name $ROLE \
  --assume-role-policy-document file:///tmp/deploy-trust.json
aws iam update-assume-role-policy --role-name $ROLE \
  --policy-document file:///tmp/deploy-trust.json
aws iam put-role-policy --role-name $ROLE \
  --policy-name deploy --policy-document file:///tmp/deploy-permissions.json

echo "=== 3/6 Create Lightsail container service (nano: 0.25 vCPU, 512 MB, \$7/mo) ==="
aws lightsail create-container-service --service-name $SERVICE \
  --power nano --scale 1 --region $REGION

echo "=== 4/6 Wait for service to be ready (takes a few minutes) ==="
for i in $(seq 1 60); do
  STATE=$(aws lightsail get-container-services --service-name $SERVICE \
    --region $REGION --query 'containerServices[0].state' --output text)
  echo "  state: $STATE"
  if [ "$STATE" = "READY" ] || [ "$STATE" = "RUNNING" ]; then break; fi
  sleep 10
done

echo "=== 5/6 Enable the ECR image puller role ==="
aws lightsail update-container-service --service-name $SERVICE \
  --private-registry-access ecrImagePullerRole={isActive=true} --region $REGION

PRINCIPAL=None
for i in $(seq 1 12); do
  sleep 10
  PRINCIPAL=$(aws lightsail get-container-services --service-name $SERVICE --region $REGION \
    --query 'containerServices[0].privateRegistryAccess.ecrImagePullerRole.principalArn' --output text)
  if [ "$PRINCIPAL" != "None" ] && [ -n "$PRINCIPAL" ]; then break; fi
  echo "  waiting for puller role principal..."
done
echo "  puller principal: $PRINCIPAL"
if [ "$PRINCIPAL" = "None" ] || [ -z "$PRINCIPAL" ]; then
  echo "ERROR: puller role principal never appeared; re-run this script in a minute."
  exit 1
fi

echo "=== 6/6 Allow the puller role to pull from the ECR repo ==="
cat > /tmp/ecr-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowLightsailPull",
    "Effect": "Allow",
    "Principal": { "AWS": "${PRINCIPAL}" },
    "Action": [ "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer" ]
  }]
}
EOF
aws ecr set-repository-policy --repository-name $REPO \
  --policy-text file:///tmp/ecr-policy.json --region $REGION

echo
echo "==============================================================="
echo "Done. Copy these two values:"
echo
echo "GitHub repo variable AWS_DEPLOY_ROLE_ARN:"
echo "  arn:aws:iam::${ACCOUNT_ID}:role/${ROLE}"
echo
echo "Lightsail service URL (for Vercel NEXT_PUBLIC_API_URL, live after first deploy):"
aws lightsail get-container-services --service-name $SERVICE \
  --region $REGION --query 'containerServices[0].url' --output text
echo "==============================================================="
