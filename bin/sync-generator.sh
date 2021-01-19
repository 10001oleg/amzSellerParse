#!/bin/bash
[ -z "$INSTANCE_IP" ] && echo "no INSTANCE_IP"
[ -z "$INSTANCE_KEY" ] && echo "no INSTANCE_KEY"
[ -z "$INSTANCE_IP" -o  -z "$INSTANCE_KEY" ] && exit 1

INSTANCE_URI=ec2-user@${INSTANCE_IP}
SSH_ARG="-o ControlMaster=auto -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${INSTANCE_KEY}"

rsync -e "ssh $SSH_ARG " -avr --times --copy-links --filter=':- ../.gitignore'  --filter=':- ./.gitignore'  --filter=':- .zipignore' ./generator/ $INSTANCE_URI:~/amzSellerGenerator/
