#!/bin/bash
# Fixes "Not authorized to perform sts:AssumeRoleWithWebIdentity" for Apollo
# deploys: creates the deploy role if it's missing, rewrites its trust policy
# to the current GitHub repo name, and re-attaches the permissions policy.
# Safe to re-run.
#
# Run in AWS CloudShell: upload via Actions -> Upload file, then:
#   bash aws-apollo-fix-trust.sh

set -u
export AWS_PAGER=""
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
GH_REPO="Akishai18/Apollo"   # must match the repo name EXACTLY, case included
ROLE=apollo-github-deploy

echo "=== Trust condition BEFORE (tells us what was wrong) ==="
aws iam get-role --role-name $ROLE \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json \
  || echo "!! role $ROLE does not exist — it will be created below"

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

aws iam create-role --role-name $ROLE \
  --assume-role-policy-document file:///tmp/deploy-trust.json 2>/dev/null \
  && echo "(role was missing — created it)"
aws iam update-assume-role-policy --role-name $ROLE \
  --policy-document file:///tmp/deploy-trust.json

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
aws iam put-role-policy --role-name $ROLE \
  --policy-name deploy --policy-document file:///tmp/deploy-permissions.json

echo
echo "=== Trust condition AFTER (must show repo:${GH_REPO}:*) ==="
aws iam get-role --role-name $ROLE \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json

echo
echo "=== OIDC provider check (must include token.actions.githubusercontent.com) ==="
aws iam list-open-id-connect-providers --output text

echo
echo "==============================================================="
echo "GitHub repo variable AWS_DEPLOY_ROLE_ARN must be EXACTLY:"
aws iam get-role --role-name $ROLE --query 'Role.Arn' --output text
echo "(no spaces before/after). Then re-run the deploy workflow."
echo "==============================================================="
