//
// Copyright 2018 by The Gardener Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

'use strict'

const _ = require('lodash')
const request = require('request')
const expressJwt = require('express-jwt')
const jwks = require('jwks-rsa')
const { JwksError } = jwks
const config = require('./config')
const logger = require('./logger')
const { HttpError, NotFound, Unauthorized } = require('./errors')

const secretProvider = jwtSecret(config.jwks)

function frontendConfig (req, res, next) {
  res.json(config.frontend)
}

function attachAuthorization (req, res, next) {
  const [scheme, bearer] = req.headers.authorization.split(' ')
  if (!/bearer/i.test(scheme)) {
    return next(new Unauthorized('No authorization header with bearer'))
  }
  req.user.auth = {bearer}
  req.user.id = req.user['email']

  next()
}

function jwt (options) {
  const secret = secretProvider
  options = _.assign({secret}, config.jwt, options)
  return expressJwt(options)
}

function getKeysMonkeyPatch (cb) {
  const json = true
  const strictSSL = _.get(this.options, 'strictSsl', false)
  const headers = _.assign({}, this.options.headers)
  const uri = this.options.jwksUri
  const ca = this.options.ca
  const rejectUnauthorized = _.get(this.options, 'rejectUnauthorized', true)
  this.logger(`Fetching keys from '${uri}'`)
  request({json, uri, headers, strictSSL, ca, rejectUnauthorized}, (err, res) => {
    if (err) {
      this.logger('Failure:', err)
      return cb(err)
    }
    const statusCode = res.statusCode
    if (_.inRange(statusCode, 200, 300)) {
      this.logger('Keys:', res.body.keys)
      return cb(null, res.body.keys)
    }
    const statusMessage = res.statusMessage || `Http Error ${statusCode}`
    this.logger('Http Error:', res.body)
    cb(new JwksError(_.get(res, 'body.message', statusMessage)))
  })
}

function jwtSecret (options) {
  const client = jwks(options)
  client.getKeys = getKeysMonkeyPatch
  return function secretProvider (req, header, payload, cb) {
    // only RS256 is supported.
    if (_.get(header, 'alg') !== 'RS256') {
      return cb(new Error('Only RS256 is supported as id_token signing algorithm'))
    }

    client.getSigningKey(header.kid, (err, key) => {
      if (err) {
        return cb(err)
      }
      return cb(null, key.publicKey || key.rsaPublicKey)
    })
  }
}

function notFound (req, res, next) {
  next(new NotFound('The server has not found anything matching the Request-URI'))
}

function errorToLocals (err, req) {
  const message = err.message
  let reason = err.reason || 'Internal Error'
  const name = err.name
  const error = req.app.get('env') === 'development' ? err : {name}
  let status = 500
  if (err instanceof HttpError) {
    status = err.code
  } else {
    switch (name) {
      case 'UnauthorizedError':
      case 'JwksError':
      case 'SigningKeyNotFoundError':
        status = 401
        reason = 'Authentication Error'
        break
    }
  }
  if (status >= 500) {
    logger.error(err.message, err.stack)
  }
  return {message, reason, status, error}
}

function sendError (err, req, res, next) {
  const locals = errorToLocals(err, req)
  res.status(locals.status).send(locals)
}

function renderError (err, req, res, next) {
  const locals = errorToLocals(err, req)
  res.status(locals.status).send(ErrorTemplate(locals))
}

const ErrorTemplate = _.template(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-type" content="text/html; charset=utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'self'; connect-src 'self'; form-action 'self'; img-src data:; script-src 'self'; style-src 'unsafe-inline'">
  <meta content="origin" name="referrer">
  <title><%= reason %> &middot; Gardener</title>
  <style type="text/css" media="screen">
    body {
      padding: 50px;
      font: 14px "Lucida Grande", Helvetica, Arial, sans-serif;
    }
    a {
      color: #00B7FF;
    }
  </style>
  </head>
</head>
<body>
  <h1><%= message %></h1>
  <h2><%= status %></h2>
  <% if (error.stack) { %><pre><%= error.stack %></pre><% } %>
</body>
</html>`)

module.exports = {
  jwt,
  jwtSecret,
  attachAuthorization,
  frontendConfig,
  notFound,
  sendError,
  renderError,
  ErrorTemplate
}