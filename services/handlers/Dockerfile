FROM lambci/lambda:nodejs8.10
USER root
WORKDIR /usr/src/handlers
RUN rm -rf node_modules *
COPY . .
RUN touch /var/lib/rpm/*
RUN yum install git -y; yum clean all
RUN npm i
# RUN sudo npm i -g serverless