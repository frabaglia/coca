"use strict"

const DBManager = require("./DBManager"),
  CacheManager = require("./CacheManager"),
  HTTPResponse = require("./HTTPResponse")

class ServerlessContextManager {
  constructor(enviromentDTO) {
    this.mdb = enviromentDTO.mdb
    this.mdbHostAndPort = enviromentDTO.mdbHostAndPort
    this.mdbPassword = enviromentDTO.mdbPassword
    this.mdbUser = enviromentDTO.mdbUser
    this.redisHostAndPort = enviromentDTO.redisHostAndPort
    this.redisPassword = enviromentDTO.redisPassword
    this.redisUser = enviromentDTO.redisUser
    this.redisDBNumber = enviromentDTO.redisDBNumber
  }

  handleDBContext(contextContainer) {
    let {
      event,
      delegatedHandler,
      awsAPIGatewayResponseCallback,
      serverlessContext
    } = contextContainer

    try {
      if (serverlessContext.mongoClient && serverlessContext.mongoClient.readyState === 1) {
        delegatedHandler(awsAPIGatewayResponseCallback, event)
      } else {
        serverlessContext.dbManager = new DBManager({
          mdb: this.mdb,
          mdbHostAndPort: this.mdbHostAndPort,
          mdbPassword: this.mdbPassword,
          mdbUser: this.mdbUser,
          isTestingEnv: process.env.TESTING === "true" ? true : false
        })

        serverlessContext.mongoClient = serverlessContext.dbManager.connectToMongoDB()

        serverlessContext.mongoClient
          .once("open", () => {
            return delegatedHandler(awsAPIGatewayResponseCallback, event)
          })
          .once("error", error => {
            return awsAPIGatewayResponseCallback(null, HTTPResponse.errorResponse(500, error.message, error.stack))
          })
      }
    } catch (error) {
      return awsAPIGatewayResponseCallback(null, HTTPResponse.errorResponse(500, error.message, error.stack))
    }
  }

  handleDBAndCacheContext(contextContainer) {

    let {
      awsAPIGatewayResponseCallback,
      serverlessContext
    } = contextContainer

    try {
      if (serverlessContext.redisClient) {
        this.handleDBContext(contextContainer)
      } else {
        serverlessContext.cacheManager = new CacheManager({
          redisHostAndPort: this.redisHostAndPort,
          redisPassword: this.redisPassword,
          redisUser: this.redisUser,
          redisDBNumber: this.redisDBNumber,
          isTestingEnv: process.env.TESTING === "true" ? true : false
        })
        serverlessContext.redisClient = serverlessContext.cacheManager.connectToRedis()
        serverlessContext.redisClient.on("error", (err) => {
          console.log("redisClient err:");
          console.log(JSON.stringify(err));
        });
        this.handleDBContext(contextContainer)
      }
    } catch (error) {
      awsAPIGatewayResponseCallback(null, HTTPResponse.errorResponse(500, error.message, error.stack))
    }
  }
}
module.exports = ServerlessContextManager