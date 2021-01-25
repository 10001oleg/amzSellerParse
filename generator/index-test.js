"use strict";

require("dotenv").config();
const mydb = require("./lib/mydb");

Error.stackTraceLimit = 100;

const genOrder = require("./genOrder");

const main = async () => {
  const opts = { client: require(__dirname + "/lib/mydb") };
  const res = await genOrder.generateOneOrder(opts, undefined, {});
  console.log(res);
};
// main();

const server = require(__dirname + "/server");
server.serverWorker({ client: mydb });
// const dashboard = async (opts) => {

// };
// dashboard();
