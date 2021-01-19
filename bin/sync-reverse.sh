#!/bin/bash
[ -z "$INSTANCE_IP" ] && echo "no INSTANCE_IP"
[ -z "$INSTANCE_KEY" ] && echo "no INSTANCE_KEY"
[ -z "$INSTANCE_IP" -o  -z "$INSTANCE_KEY" ] && exit 1

INSTANCE_URI=ec2-user@${INSTANCE_IP}
SSH_ARG="-o ControlMaster=auto -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${INSTANCE_KEY}"

rsync -e "ssh $SSH_ARG " -avr --times --copy-links --exclude node_modules --filter=':- .gitignore' --filter=':- .zipignore' $INSTANCE_URI:~/amzSellerParse/ ./
