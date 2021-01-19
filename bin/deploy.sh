#!/bin/bash

aws cloudformation package \
    --template-file template.yaml \
    --output-template-file packaged.yaml \
    --s3-bucket oleg10001-deployment
rc=$?
if [ $rc -eq 0 ]
then
    echo "Do DEPLOY"
    aws cloudformation deploy \
      --template-file ./packaged.yaml \
      --stack-name adh-dev \
      --parameter-overrides DbUri="postgresql://postgres:-7%258EG0j49%5E%23%3Dm%3D@pg-01.cmc4tnhk3rsf.us-west-2.rds.amazonaws.com:5432/sp" \
      --capabilities CAPABILITY_IAM
fi