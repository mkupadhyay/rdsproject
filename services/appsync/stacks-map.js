'use strict';

module.exports = {
  'AWS::AppSync::ApiKey': { destination: 'AppSync', allowSuffix: true },
  'AWS::AppSync::DataSource': { destination: 'AppSync', allowSuffix: true },
  'AWS::AppSync::GraphQLApi': { destination: 'AppSync', allowSuffix: true },
  'AWS::AppSync::GraphQLSchema': { destination: 'AppSync', allowSuffix: true },
  'AWS::AppSync::Resolver': { destination: 'AppSyncResolver', allowSuffix: true }
};
