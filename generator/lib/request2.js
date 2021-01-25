"use strict";
const https = require("https");
const qs = require("querystring");
const zlib = require("zlib");
const xml2json = require("xml2json");

const defOptions = {
  //hostname: "marketplace.walmartapis.com",
  port: 443,
  method: "GET",
  headers: {
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip, deflate",
    //TODO: User-Agent: <Your User Agent Header>
  },
};

const request = async (opts, params, queryParams, requestBody = undefined) => {
  if (opts === undefined) opts = {};
  // prettier-ignore
  const logPrefix = `${opts.logPrefix ? opts.logPrefix : ""} request2()`;

  const options = {
    ...defOptions,
    ...params,
    headers: {
      ...defOptions.headers,
      ...params.headers,
    },
  };

  // Working with requstBody
  const strQS = qs.stringify(queryParams);
  let queryParamsInBody = false;
  if (requestBody === undefined || requestBody == "") {
    if (
      options.method == "POST" &&
      options.headers["Content-Type"] &&
      options.headers["Content-Type"].match("x-www-form-urlencoded") //TODO Add case insensitive content-type
    ) {
      requestBody = strQS;
      queryParamsInBody = true;
    }
  }

  if (strQS.length > 0) {
    if (options.method == "POST" && !queryParamsInBody) {
      options.path =
        options.path + (options.path.indexOf("?") >= 0 ? "&" : "?") + strQS;
    } else if (options.method == "GET") {
      requestBody = "";
      options.path =
        options.path + (options.path.indexOf("?") >= 0 ? "&" : "?") + strQS;
    }
  }

  if (requestBody === undefined || requestBody === null) {
    requestBody = "";
  }

  const bufferRequestBody = Buffer.from(requestBody);
  if (options.method == "POST") {
    options.headers["Content-Length"] = bufferRequestBody.byteLength;
  }

  const dateBeforeRequest = new Date();
  let dateLastStage = new Date();

  const result = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      //let body = "";
      const chunks = [];
      const dateGetRequest = new Date();
      res.on("end", () => {
        const dateEndRequest = new Date();
        const buffer = Buffer.concat(chunks);

        const result = {
          headers: res.headers,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          duration: {
            request: +[dateGetRequest - dateBeforeRequest],
            download: +[dateEndRequest - dateGetRequest],
          },
        };

        const encoding = res.headers["content-encoding"];
        if (encoding == "gzip") {
          zlib.gunzip(buffer, (err, decoded) => {
            result.body = decoded;
            result.duration.decompress = +[new Date() - dateLastStage];
            dateLastStage = new Date();
            resolve(result);
          });
        } else if (encoding == "deflate") {
          zlib.inflate(buffer, (err, decoded) => {
            result.body = decoded;
            result.duration.decompress = +[new Date() - dateLastStage];
            dateLastStage = new Date();
            resolve(result);
          });
        } else {
          resolve({ ...result, body: buffer });
        }
      });
      res.on("data", (chunk) => chunks.push(chunk));
      // res.on("data", (chunk) => {
      //   body += chunk;
      // });
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
    req.write(bufferRequestBody);
    req.end();
  });

  if (Buffer.isBuffer(result.body)) {
    result.body = result.body.toString();
  }

  //TODO Add case insensitive content-type
  if (
    result.headers &&
    result.headers["content-type"] &&
    result.headers["content-type"].match(/^text\/xml/i)
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
  } else if (
    result.headers &&
    result.headers["content-type"] &&
    result.headers["content-type"].match(/^application\/json/i)
  ) {
    try {
      result.origBody = result.body;
      result.body = result.body == "" ? {} : JSON.parse(result.origBody);
    } catch (err) {
      console.error(
        "%s Error: %s\nStack: %s",
        logPrefix,
        err.message,
        err.stack
      );
    }
  }
  return result;
};
module.exports = {
  request,
};
