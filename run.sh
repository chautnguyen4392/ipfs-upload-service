#!/bin/bash
. /home/cbdigi/.nvm/nvm.sh
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd $SCRIPT_DIR
nvm use

echo "Start ipfs upload service !!!" >> output.log
npm start >> output.log

