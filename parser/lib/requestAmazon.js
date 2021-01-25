"use strict";
const https = require("https");
const qs = require("qs");
const crypto = require("crypto");
const xml2json = require("xml2json");

const defOptions = {
  hostname: "mws.amazonservices.com",
  port: 443,
  method: "GET",
  headers: {
    //"Content-Type": "application/json",
    "Content-Type": "x-www-form-urlencoded",
    //TODO: User-Agent: <Your User Agent Header>
    // AppId/AppVersionId (Language=LanguageNameAndOptionallyVersion)
    // My Seller Tool/2.0 (Language=Java/1.6.0.11; Platform=Windows/XP)
    // MyCompanyName/build1611 (Language=Perl; Host=jane.laptop.example.com)
  },
};

const request = async (
  opts,
  { cred },
  params,
  queryParams,
  requestBody = undefined
) => {
  if (opts === undefined) opts = {};
  // prettier-ignore
  const logPrefix = `${opts.logPrefix ? opts.logPrefix : ""} requestAmazon()`;

  const options = {
    ...defOptions,
    ...params,
    headers: {
      ...defOptions.headers,
      ...params.headers,
    },
  };

  if (!queryParams.AWSAccessKeyId)
    queryParams.AWSAccessKeyId = cred.AWS_ACCESS_KEY_ID;
  if (!queryParams.MWSAuthToken) queryParams.MWSAuthToken = cred.AUTH_TOKEN;
  if (!queryParams.SellerId) queryParams.SellerId = cred.SELLER_ID;
  if (!queryParams.Marketplace && !queryParams.MarketplaceId) {
    if (
      options.path.includes("/2011-10-01") ||
      options.path.includes("/2013-07-01")
    ) {
      queryParams.MarketplaceId = cred.MARKETPLACE_ID;
    } else {
      queryParams.Marketplace = cred.MARKETPLACE_ID;
    }
  }

  queryParams.SignatureMethod = "HmacSHA256";
  queryParams.SignatureVersion = "2";
  queryParams.Timestamp = new Date().toISOString();

  if (requestBody === undefined || requestBody === null) requestBody = "";

  // Calculate ContentMD5
  if (requestBody) {
    queryParams.ContentMD5Value = crypto
      .createHash("md5")
      .update(requestBody)
      .digest("base64");
    options.headers["Content-MD5"] = queryParams.ContentMD5Value;
  }

  // Add signature
  const arrToSign = [];
  arrToSign.push(options.method);
  arrToSign.push(options.hostname);
  arrToSign.push(options.path);
  arrToSign.push(
    qs.stringify(
      Object.fromEntries(
        Object.keys(queryParams)
          .sort()
          .map((k) => [k, queryParams[k]])
      )
    )
  );

  const stringToSign = arrToSign
    .join("\n")
    .replace(/'/g, "%27")
    .replace(/\*/g, "%2A")
    .replace(/\(/g, "%28");
  queryParams.Signature = crypto
    .createHmac("sha256", cred.AWS_SECRET_ACCESS_KEY)
    .update(stringToSign, "utf8")
    .digest("base64");

  if (options.method == "POST") {
    options.path = options.path + "?" + qs.stringify(queryParams);
  } else if (options.method == "GET") {
    requestBody = "";
    options.path = options.path + "?" + qs.stringify(queryParams);
  } else {
    console.error("Error options.method = " + options.method);
    return undefined;
  }

  options.headers["Content-Length"] = requestBody
    ? Buffer.from(requestBody).byteLength
    : 0;

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("end", () => {
        const result = {
          body: body,
          headers: res.headers,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
        };
        //TODO Add case insensitive content-type
        if (
          res.headers &&
          res.headers["content-type"] &&
          res.headers["content-type"].match(/^text\/xml/i)
        ) {
          // Convert body from xml to json
          try {
            result.origBody = result.body;
            result.body = JSON.parse(xml2json.toJson(result.origBody));
          } catch (err) {
            console.error(
              "%s Error: %s\nStack: %s",
              logPrefix,
              err.message,
              err.stack
            );
          }
        }
        resolve(result);
      });
      res.on("data", (chunk) => {
        body += chunk;
      });
    });
    req.on("error", (err) => {
      console.error(
        "%s Error: %s\nStack: %s",
        logPrefix,
        err.message,
        err.stack
      );
      reject(err);
    });
    req.write(requestBody);
    req.end();
  });
};

module.exports.handler = request;
