#!/bin/bash
# Fixes "Not authorized to perform sts:AssumeRoleWithWebIdentity" for Apollo.
#
# Root cause (diagnosed from the run logs, 2026-08-30): GitHub now issues this
# repo's OIDC tokens with IMMUTABLE-ID subjects —
#   sub = "repo:Akishai18@130519154/Apollo@1262253140:ref:refs/heads/main"
# which does not match a trust policy written for "repo:Akishai18/Apollo:*".
# This trusts BOTH formats (and pins the numeric IDs, which survive renames).
# Also applies the same dual-format trust to the SignalM role so its scheduled
# deploys keep working if GitHub flips that repo's token format too.
#
# Run in AWS CloudShell: upload via Actions -> Upload file, then:
#   bash aws-apollo-fix-trust.sh

set -u
export AWS_PAGER=""
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
OWNER_ID=130519154        # github.com/Akishai18 (immutable)
APOLLO_ID=1262253140      # Apollo repo id (immutable)
SIGNALM_ID=1122048994     # SignalM repo id (immutable)

write_trust() { # $1 = owner/name  $2 = repo numeric id  -> /tmp/deploy-trust.json
  cat > /tmp/deploy-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": [
        "repo:${1}:*",
        "repo:Akishai18@${OWNER_ID}/${1#*/}@${2}:*"
      ] }
    }
  }]
}
EOF
}

echo "=== 1/2 apollo-github-deploy: trust both sub formats ==="
write_trust "Akishai18/Apollo" "$APOLLO_ID"
aws iam update-assume-role-policy --role-name apollo-github-deploy \
  --policy-document file:///tmp/deploy-trust.json
aws iam get-role --role-name apollo-github-deploy \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringLike' --output json

echo "=== 2/2 signalm-github-deploy: same fix, preemptively ==="
write_trust "Akishai18/SignalM" "$SIGNALM_ID"
aws iam update-assume-role-policy --role-name signalm-github-deploy \
  --policy-document file:///tmp/deploy-trust.json
aws iam get-role --role-name signalm-github-deploy \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringLike' --output json

echo
echo "Done. Re-run the 'Deploy API to Lightsail' workflow in the Apollo repo."
