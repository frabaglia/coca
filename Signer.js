"use strict"

const crypto = require("crypto");
const moment = require("moment");
const { google } = require("googleapis");
const fetch = require("./Fetch");
const OAuth2 = google.auth.OAuth2;
const oauth2 = google.oauth2("v2");
const IV_LENGTH = 16; //For AES, this is always 16
const algorithm = "aes-256-cbc";
const jws = require("jws");
const md5 = require("md5");
const _ = require("lodash");
const ERRORS = require("./Errors")

function encrypt(text, encryptSecret) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(algorithm, new Buffer(encryptSecret), iv);
  const encrypted = cipher.update(text);
  return iv.toString("hex") + ":" + Buffer.concat([encrypted, cipher.final()]).toString("hex");
}

function decrypt(text, encryptSecret) {
  const textParts = text.split(":");
  const iv = new Buffer(textParts.shift(), "hex");
  const encryptedText = new Buffer(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv(algorithm, new Buffer(encryptSecret), iv);
  const decrypted = decipher.update(encryptedText);
  return Buffer.concat([decrypted, decipher.final()]).toString();
}

exports.nonValidSESVerification = (response, email) => {
  return !(response.VerificationAttributes &&
    response.VerificationAttributes[email] &&
    response.VerificationAttributes[email].VerificationStatus &&
    response.VerificationAttributes[email].VerificationStatus === "Success");
}
exports.parseChecksum = (row) => {
  const alert = _.clone(row, false);
  delete alert.timestamp;
  return md5(JSON.stringify(alert));
}

function isValidHeader(authorization) {
  return !authorization;
}

exports.sign = (payload, secret, encryptSecret) => {
  return jws.sign({
    header: { alg: "HS256" },
    payload: encrypt(JSON.stringify(payload), encryptSecret),
    secret
  });
};

exports.loginBeforeRequest = (req, res, next) => {

  if (isValidHeader(req.headers.authorization)) {
    return res.status(401).send(ERRORS.AUTH.UNAUTHORIZED);
  }

  try {
    const id = JSON.parse(decrypt(jws.decode(req.headers.authorization).payload, req.encryptSecret)).identifier;

    req.userId = id;
    next();
  } catch (e) {
    res.status(401).send(`${ERRORS.AUTH.UNAUTHORIZED} with error: ${e.message}`);
  }
};

exports.vibraniumLambdaShield = async (authorizationHeader, encryptSecret, updatingPassword = false) => {
  if (isValidHeader(authorizationHeader)) {
    return Promise.reject({ message: ERRORS.AUTH.NOT_FOUND, expire: false });
  }
  try {
    const splitted = authorizationHeader.split(" ")

    if (splitted.length === 2) {
      authorizationHeader = splitted[1]
    }

    let jwt = JSON.parse(decrypt(jws.decode(authorizationHeader).payload, encryptSecret));

    const now = moment().format();

    if (jwt.exp <= now) {
      return Promise.reject({ message: ERRORS.AUTH.EXPIRED, expire: true, id: jwt.id });
    }

    if ((!jwt.email || !jwt.password) && !updatingPassword) {
      return Promise.reject({ message: ERRORS.AUTH.STRICT_LOGIN, expire: false });
    }

    return jwt
  } catch (e) {
    return Promise.reject({ message: `${ERRORS.AUTH.UNAUTHORIZED} with error: ${e.message}`, expire: false });
  }
}

exports.weakLambdaShield = async (authorizationHeader, encryptSecret) => {
  if (isValidHeader(authorizationHeader)) {
    return null
  }
  try {
    const splitted = authorizationHeader.split(" ")

    if (splitted.length === 2) {
      authorizationHeader = splitted[1]
    }

    let jwt = JSON.parse(decrypt(jws.decode(authorizationHeader).payload, encryptSecret));

    const now = moment().format();

    if (jwt.exp <= now) {
      return Promise.reject({ message: ERRORS.AUTH.EXPIRED, expire: true, id: jwt.id });
    }

    return jwt
  } catch (e) {
    return Promise.reject({ message: `${ERRORS.AUTH.UNAUTHORIZED} with error: ${e.message}`, expire: false });
  }
}

exports.getSocialUrl = (type, domain, id, secret) => {
  switch (type) {
    case "google":
      return getGoogleUrl(domain, id, secret);
    case "facebook":
      return getFacebookUrl(domain, id, secret);
    default:
      return getGoogleUrl(domain, id, secret);
  }
};

function getGoogleUrl(domain, id, secret) {
  const callback = getCallbackUrl(domain, "google");
  const oauth2Client = new OAuth2(
    id,
    secret,
    callback
  );

  return oauth2Client.generateAuthUrl({
    scope: ["https://www.googleapis.com/auth/userinfo.email"]
  });
};

function getFacebookUrl(domain, id, secret) {
  const oauthUrl = "https://www.facebook.com/v2.12/dialog/oauth";
  const callback = getCallbackUrl(domain, "facebook");
  return `${oauthUrl}?scope=email&client_id=${id}&redirect_uri=${callback}`;

}

function getCallbackUrl(domain, type) {
  return `${domain}/login/social/callback/${type}`;
}

const getGoogleOAuthClient = async (type, code, domain, googleId, googleSecret) => {
  const callback = getCallbackUrl(domain, type);

  const client = new OAuth2(
    googleId,
    googleSecret,
    callback
  );

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens)
  return client
}

const getGoogleUser = async (type, code, domain, googleId, googleSecret) => {
  const client = await getGoogleOAuthClient(type, code, domain, googleId, googleSecret);
  const userInfo = await getGoogleUserInfo(client);
  return {
    email: userInfo.data.email,
    name: userInfo.data.name,
    lastName: userInfo.data.family_name,
    id: userInfo.data.id
  };
};

const getFacebookUser = async (type, code, domain, id, secret) => {
  const client = await getClientFacebook(type, code, domain, id, secret);
  const userInfo = await getFacebookUserInfo(client.data);
  return {
    email: userInfo.data.email,
    name: userInfo.data.first_name,
    lastName: userInfo.data.last_name,
    id: userInfo.data.id
  };
}

exports.getUser = async (type, code, domain, googleId, googleSecret) => {
  switch (type) {
    case "google":
      return getGoogleUser(type, code, domain, googleId, googleSecret);
    case "facebook":
      return getFacebookUser(type, code, domain, googleId, googleSecret);
    default:
      return getGoogleUser(type, code, domain, googleId, googleSecret);
  }
}


function getClientFacebook(type, code, domain, id, secret) {
  const callback = getCallbackUrl(domain, "facebook");
  const query = {
    client_id: id,
    redirect_uri: callback,
    client_secret: secret,
    code: code
  };

  return fetch.get("https://graph.facebook.com/v2.12/oauth/access_token", query);
}

function getGoogleUserInfo(client) {
  const getUserInfo = (resolve, reject) => {
    const wrapResult = (err, user) => {
      if (err) { return reject(err); }
      resolve(user);
    };

    return oauth2.userinfo.get({
      auth: client
    }, wrapResult);
  };

  return new Promise(getUserInfo);
}

function getFacebookUserInfo(client) {
  const query = {
    access_token: client.access_token,
    fields: "id,email,first_name,last_name",
  };

  return fetch.get("https://graph.facebook.com/me", query);
}