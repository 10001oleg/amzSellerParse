"use strict";
const { request } = require("../../lib/request2");

const requestUPS = (opts, cred, params, body = "") => {
  if (!cred.username) throw Error("requestUPS: no cred 'username'");
  if (!cred.password) throw Error("requestUPS: no cred 'password'");
  if (!cred.accessLicenseNumber)
    throw Error("requestUPS: no cred 'accessLicenseNumber'");
  if (!cred.transactionSrc) throw Error("requestUPS: no cred 'transactionSrc'");

  if (!params.path) throw Error("no param 'path'");

  return request(
    opts,
    {
      hostname:
        cred.environment && cred.environment === "sandbox"
          ? "wwwcie.ups.com"
          : "onlinetools.ups.com",
      port: 443,
      method: "POST",
      ...params,
      headers: {
        AccessLicenseNumber: cred.accessLicenseNumber,
        Username: cred.username,
        Password: cred.password,
        transactionSrc: cred.transactionSrc,
        transId: Math.random().toString(36).slice(2), //Generate uid,
        ...params.headers,
      },
    },
    {},
    body
  );
};

module.exports = {
  requestUPS,
};
