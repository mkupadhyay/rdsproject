#!/bin/bash
dir="$(pwd)";
echo $(pwd)
docker build --rm -t lambda .
docker run -d lambda
cid=$(docker ps -alq)
docker cp $cid:/usr/src/handlers .