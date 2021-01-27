#!/bin/bash
[ -z "$INSTANCE_IP" ] && echo "no INSTANCE_IP"
[ -z "$INSTANCE_KEY" ] && echo "no INSTANCE_KEY"
[ -z "$INSTANCE_IP" -o  -z "$INSTANCE_KEY" ] && exit 1

[ -z "${SSH_KNOWN_TMPFILE}" ] && SSH_KNOWN_TMPFILE=/tmp/${USER}-known_hosts

INSTANCE_URI=ec2-user@${INSTANCE_IP}
SSH_ARG="-o ControlMaster=yes -o UserKnownHostsFile=${SSH_KNOWN_TMPFILE} -i ${INSTANCE_KEY}"

CMD="'printf \"\033]0;amz-parse\007\"; screen -dr || screen -S amDistr'"
[ -n "$1" ] && CMD=""
ssh -t -L 5802:127.0.0.1:5901 ${SSH_ARG} ${INSTANCE_URI} "${CMD}"