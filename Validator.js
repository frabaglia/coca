"use strict"
const
  parallel = require("async/parallel"),
  reflectAll = require("async/reflectAll"),
  ERRORS = require("./Errors")

class Validator {
  constructor() {}

  isNotConstraintKey(key) {
    return key !== "required" && key !== "type"
  }

  isValidMongooseId(id) {
    return (/[a-fA-F0-9]{24}/).test(id)
  }

  getRequiredErrors(schema, body, schemaKey) {
    let
      requiredKey = schema[schemaKey].required,
      errors = []

    if (requiredKey) {

      if (!body) {
        errors.push(schemaKey + ERRORS.REQUIRED_PARAM)
      } else if (typeof body[schemaKey] === "undefined" || body[schemaKey] === null) {
        errors.push(schemaKey + ERRORS.REQUIRED_PARAM)
      }
    }

    return errors.slice()
  }

  getTypeErrors(schema, body, schemaKey) {
    let
      // https://developer.mozilla.org/es/docs/Web/JavaScript/Referencia/Objetos_globales/Function/name
      typeKey = schema[schemaKey].type.name,
      errors = []

    if (typeKey === "String" && typeof body[schemaKey] !== "string") {
      errors.push(schemaKey + ERRORS.SHOULD_BE_STRING)
    }

    if (typeKey === "Number" && typeof body[schemaKey] !== "number") {
      errors.push(schemaKey + ERRORS.SHOULD_BE_NUMBER)
    }
    if (typeKey === "Boolean" && typeof body[schemaKey] !== "boolean") {
      errors.push(schemaKey + ERRORS.SHOULD_BE_BOOLEAN)
    }
    if (typeKey === "Date" && isNaN(Date.parse(body[schemaKey]))) {
      errors.push(schemaKey + ERRORS.SHOULD_BE_DATE)
    }

    return errors.slice()
  }

  spliceConstraintKeys(schemaKeys) {
    if (schemaKeys.indexOf("type") > -1) {
      schemaKeys.splice(schemaKeys.indexOf("type"), 1)
    }
    if (schemaKeys.indexOf("required") > -1) {
      schemaKeys.splice(schemaKeys.indexOf("required"), 1)
    }
    return schemaKeys
  }

  validateJSONSchema(schema, body, top) {

    let
      schemaKeys = Object.keys(schema),
      errors = []

    schemaKeys.forEach((schemaKey) => {
      if (this.isNotConstraintKey(schemaKey)) {

        let isRequired = schema[schemaKey].required

        if (typeof schema[schemaKey].required === "function") {
          let validator = schema[schemaKey].required.bind(top)
          isRequired = validator()
        }

        if (isRequired) {
          errors = errors.concat(this.getRequiredErrors(schema, body, schemaKey))
        }

        if (body && body[schemaKey] && schema[schemaKey].type) {
          errors = errors.concat(this.getTypeErrors(schema, body, schemaKey))
        }
      }
    })

    this.spliceConstraintKeys(schemaKeys).forEach((schemaKey) => {

      if (body && typeof body[schemaKey] === "object") {
        errors = errors.concat(this.validateJSONSchema(schema[schemaKey], body[schemaKey], top))
      }
    })

    return errors.slice()
  }

  isValidJSONSchema(schema, alert) {

    const validatingPromise = (resolve, reject) => {

      let errors = []

      if (!alert) {
        errors.push(ERRORS.UNDEFINED_PAYLOAD)
      }

      if (!schema) {
        errors.push(ERRORS.UNDEFINED_SCHEMA)
      }

      errors = errors.concat(this.validateJSONSchema(schema, alert, alert))

      if (errors.length > 0) {
        reject(JSON.stringify(errors))
      } else {
        resolve(alert)
      }
    }

    return new Promise(validatingPromise)

  }

  isValidJSONArraySchema(schema, alertArray) {
    return new Promise((res, rej) => {

      let tasks = alertArray.map((alert, index) => {
        return (callback) => {
          this.isValidJSONSchema(schema, alert)
            .then(() => {
              return callback(null, alert)
            })
            .catch((validationError) => {

              let
                message = validationError && validationError.message ? validationError.message : validationError

              try {
                message = JSON.parse(message)
              } catch (error) {
                message = message
              }

              return callback({
                message,
                index
              })
            })
        }
      })

      const asyncCallbackHandler = (brutalException, resultArray) => {
        if (brutalException) {
          return rej(brutalException)
        }

        let
          errors = resultArray.map(result => {
            let alert = result && result.error ? result : null
            return alert
          }),
          finalResultArray = resultArray.map(result => {
            let alert = result && !result.error && result.value ? result : null
            return alert
          })


        return res({
          errors: errors.filter(el => el !== null).map(el => el.error),
          success: finalResultArray.filter(el => el !== null).map(el => el.value)
        })
      }

      return parallel(reflectAll(tasks), asyncCallbackHandler)
    })
  }

}

// ** Single instance pattern ** //
module.exports = new Validator()
