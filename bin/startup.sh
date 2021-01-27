#!/bin/bash

LANG=C.UTF-8
export LANG
export HOME
SHELL=/bin/bash
export SHELL
TERM=xterm-256color
export TERM

session=adh
# create 0 windows (with use default title). Do not remove
screen -S $session -A -d -m -t bash

sleep 1
screen -S $session -X screen -t parser
screen -S $session -X screen -t generator

sleep 1
screen -S $session -p parser    -X stuff $'cd ~/adh/parser && npm start\n'
screen -S $session -p generator -X stuff $'cd ~/adh/generator && npm start\n'
