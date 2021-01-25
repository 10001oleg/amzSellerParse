#!/bin/bash

sudo amazon-linux-extras install epel
# sudo tee /etc/yum.repos.d/google-chrome.repo <<EOF
# [google-chrome]
# name=google-chrome
# baseurl=http://dl.google.com/linux/chrome/rpm/stable/x86_64
# enabled=1
# gpgcheck=1
# gpgkey=https://dl.google.com/linux/linux_signing_key.pub
# EOF

sudo yum groupinstall -y xfce && \
sudo yum install -y screen mc tigervnc-server make gcc gcc-c++ chromium

# disable scree nauto update title
sudo touch /etc/sysconfig/bash-prompt-screen
sudo chmod +x /etc/sysconfig/bash-prompt-screen

#setup vnc
sudo cp /lib/systemd/system/vncserver@.service /etc/systemd/system/vncserver@.service
sudo sed -i 's/<USER>/ec2-user/' /etc/systemd/system/vncserver@.service
sudo systemctl daemon-reload
sudo systemctl enable vncserver@:1
sudo systemctl start vncserver@:1

# CPU 100% top (random geenrator)
sudo systemctl disable --now rngd

# AS USER
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.37.2/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 12.19

tee ~/.screenrc <<EOF
#If set to on, "alternate screen" support is enabled in virtual terminals, just like in xterm.  Initial setting is ‘off’.
altscreen on
backtick 1 60 60 $HOME/bin/get_uptime
backtick 2 60 60 $HOME/bin/get_cputemp Core0
backtick 3 60 60 $HOME/bin/get_freemem
backtick 4 60 60 $HOME/bin/get_freeswap
backtick 5 60 60 $HOME/bin/get_volume PCM
backtick 6 60 60 $HOME/bin/get_gmail
backtick 7 60 60 $HOME/bin/get_updates

hardstatus alwayslastline
hardstatus string '%{= kg}%{G}%H%{g}|%< %{= kw}%?%-Lw%?%{r}(%{W}%n*%f%t%?(%u)%?%{r})%{w}%?%+Lw%?%?%= %{g}|%{W} %l %{g}|%{B} %{W}%c %{g}'
EOF

mkdir ~/amzSellerParse ~/amzSellerGenerator