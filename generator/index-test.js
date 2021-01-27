"use strict";

require("dotenv").config();

Error.stackTraceLimit = 100;

const genOrder = require("./genOrder");

const main = async () => {
  const opts = { client: require(__dirname + "/lib/mydb") };
  const res = await genOrder.generateOneOrder(opts, undefined, {});
  console.log(res);
};
main();

// const mydb = require("./lib/mydb");
// const server = require(__dirname + "/server");
// server.serverWorker({ client: mydb });
// const dashboard = async (opts) => {

// };
// dashboard();
