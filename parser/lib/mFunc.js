const util = require("util");

const utilPrint = (obj, depth = 5) =>
  util.inspect(obj, {
    showHidden: false,
    depth: depth,
  });

// Use by mwsUpdateOrderByLastUpdate
const dateToUsaStyle = (objDate) => {
  return (
    (objDate.getUTCMonth() + 1).toString().padStart(2, "0") +
    "." +
    objDate.getUTCDate().toString().padStart(2, "0") +
    "." +
    objDate.getUTCFullYear().toString().padStart(4, "0") +
    " " +
    objDate.getUTCHours().toString().padStart(2, "0") +
    ":" +
    objDate.getUTCMinutes().toString().padStart(2, "0") +
    ":" +
    objDate.getUTCSeconds().toString().padStart(2, "0") +
    ""
  );
};
const dateToUtcISOString = (objDate) =>
  objDate.getUTCFullYear().toString().padStart(4, "0") +
  "-" +
  (objDate.getUTCMonth() + 1).toString().padStart(2, "0") +
  "-" +
  objDate.getUTCDate().toString().padStart(2, "0") +
  "T" +
  objDate.getUTCHours().toString().padStart(2, "0") +
  ":" +
  objDate.getUTCMinutes().toString().padStart(2, "0") +
  ":" +
  objDate.getUTCSeconds().toString().padStart(2, "0") +
  "Z";
const forceArray = (val) =>
  Array.isArray(val) ? val : val === undefined || val === null ? [] : [val];

const getAPItype = (event) => {
  //const getAPItype = (event, context) => {
  let bodyObj = event;

  try {
    if (typeof event == "object") {
      if (typeof event.body === "string") {
        console.log("getAPItype() try parse event.body");
        try {
          bodyObj = JSON.parse(event.body);
        } catch (err) {
          bodyObj = event.body;
        }
      } else if (typeof event.body === "object" && event.body !== undefined) {
        bodyObj = event.body;
      }
    }
  } catch (err) {
    // eslint
  }

  try {
    if (typeof event == undefined) return {};
    if (!(typeof event == "object")) return {};
    if (event.pathParameters) {
      if (event.pathParameters.proxy) {
        return { APItype: event.pathParameters.proxy, body: bodyObj };
      }
    }
    const { APItype } = bodyObj;
    return { APItype, body: bodyObj };
  } catch (err) {
    console.error("Error: %s\nStack: %s", err.message, err.stack);
  }
  return {};
};

// const camelize = (str) =>
//   str
//     .replace(/(?:^\w|[A-Z]|\b\w)/g, function (word, index) {
//       return index === 0 ? word.toLowerCase() : word.toUpperCase();
//     })
//     .replace(/\s+/g, "");

// const uniq = (arr) => arr.filter((e, i, arr) => arr.indexOf(e) === i);

// NOT USING NOW
// const sortObjByKey = (value) =>
//   typeof value === "object" && value !== undefined && value !== null
//     ? Array.isArray(value)
//       ? value.map(sortObjByKey)
//       : Object.keys(value)
//           .sort()
//           .reduce((o, key) => {
//             const v = value[key];
//             o[key] = sortObjByKey(v);
//             return o;
//           }, {})
//     : value;

module.exports = {
  dateToUsaStyle,
  dateToUtcISOString,
  utilPrint,
  forceArray,
  getAPItype,
};
