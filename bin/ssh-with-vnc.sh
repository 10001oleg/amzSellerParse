#!/bin/bash
[ -z "$INSTANCE_IP" ] && echo "no INSTANCE_IP"
[ -z "$INSTANCE_KEY" ] && echo "no INSTANCE_KEY"
[ -z "$INSTANCE_IP" -o  -z "$INSTANCE_KEY" ] && exit 1

INSTANCE_URI=ec2-user@${INSTANCE_IP}
SSH_ARG="-o ControlMaster=auto -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${INSTANCE_KEY}"

ssh -t -L 5802:127.0.0.1:5901 ${SSH_ARG} ${INSTANCE_URI} 'printf "\033]0;amz-parse\007"; screen -dr || screen -S amDistr'