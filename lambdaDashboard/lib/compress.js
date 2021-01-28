const util = require("util");
const zlib = require("zlib");

const deflate = util.promisify(zlib.deflate);

const handler = async (data) => {
  const compressedBody = await deflate(JSON.stringify(data));

  return {
    statusCode: 200,
    body: compressedBody.toString("base64"),
    isBase64Encoded: true,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Content-Encoding": "deflate",
    },
  };
};

const tryCompress = async (data, event) => {
  const defaultAccessControl = {
    "Access-Control-Allow-Origin":
      event && typeof event == "object" && event.headers && event.headers.origin
        ? event.headers.origin
        : "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "3600",
  };

  const logPrefix = "tryCompress()";
  if (typeof data == "string") {
    try {
      data = JSON.parse(data);
    } catch (err) {
      // eslint
    }
  }
  let ret;
  if (typeof data == "string") {
    ret = {
      statusCode: data == "" ? 400 : 200,
      body: data,
      headers: {
        "Content-Type": "text/plain",
        ...defaultAccessControl,
      },
    };
  } else if (typeof data == "object" && data !== null && data !== undefined) {
    ret = {
      statusCode: data.statusCode ? data.statusCode : 200,
      body: JSON.stringify(data.body ? data.body : data),
    };
  } else {
    ret = {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  }
  ret.headers = {
    "Content-Type": "application/json",
    ...defaultAccessControl,
    ...ret.headers,
  };

  let canEncode = false;
  if (event.headers) {
    Object.keys(event.headers)
      .filter((k) => k.match(/accept-encoding/i))
      .map((k) => {
        if (event.headers[k].match(/deflate/)) canEncode = true;
      });
  }
  if (canEncode && ret.body && ret.body.length > 1024) {
    console.log("%s DO compress", logPrefix);
    const buf = await deflate(ret.body);
    ret.body = buf.toString("base64");
    ret.isBase64Encoded = true;
    ret.headers["Content-Encoding"] = "deflate";
  } else {
    console.log(
      "%s do not compress\nret.body=%s\nevent.headers = %s",
      logPrefix,
      ret.body,
      JSON.stringify(event.headers)
    );
  }

  return ret;
};
module.exports = {
  handler,
  tryCompress,
};
