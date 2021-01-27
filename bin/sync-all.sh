#!/bin/bash
[ -z "$INSTANCE_IP" ] && echo "no INSTANCE_IP"
[ -z "$INSTANCE_KEY" ] && echo "no INSTANCE_KEY"
[ -z "$INSTANCE_IP" -o  -z "$INSTANCE_KEY" ] && exit 1

[ -z "${SSH_KNOWN_TMPFILE}" ] && SSH_KNOWN_TMPFILE=/tmp/${USER}-known_hosts

INSTANCE_URI=ec2-user@${INSTANCE_IP}
SSH_ARG="-o ControlMaster=auto -o UserKnownHostsFile=${SSH_KNOWN_TMPFILE} -i ${INSTANCE_KEY}"
RSYNC_EXTRA_ARGS=""

rsync -e "ssh $SSH_ARG " \
    -avr --times --copy-links \
    ${RSYNC_EXTRA_ARGS} \
    --filter=':- ../.gitignore' \
    --filter=':- ./.gitignore' \
    --filter=':- .zipignore' \
    ./ $INSTANCE_URI:~/adh/