#!/bin/bash
. /home/cbdigi/.nvm/nvm.sh
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd $SCRIPT_DIR
nvm use

while true; do
    sleep 1
    npm start >> output.log
    echo "Restart ipfs upload service !!!" >> output.log
done