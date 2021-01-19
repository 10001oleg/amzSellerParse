"use strict";

const { Pool } = require("pg");
var pgPool; // = new Client({});

/*
  @param none
  @result false if no error or array with error object
*/
const updatePgConnection = async (opts) => {
  const { logPrefix = "" } = opts;
  try {
    if (pgPool == undefined) {
      console.log(logPrefix + "CREATING CONNECTION");
      pgPool = new Pool({ max: 24, idleTimeoutMillis: 1000 });
      pgPool.on("connect", (client) => {
        if (!process.env["XDG_SESSION_DESKTOP"]) {
          if (opts && opts.isTG === true) {
            client.query("SET application_name = 'MWS-TG'");
          } else {
            client.query("SET application_name = 'MWS-API'");
          }
        } else {
          client.query("SET application_name = 'MWS-local'");
        }
      });
    }
    return false;
  } catch (err) {
    if (err.message && err.message.includes("already been connect"))
      return false;
    console.error(
      "%s Failed PG connection, Error: %s\nStack: %s",
      logPrefix,
      err.error,
      err.stack
    );
    return true;
    // return {
    //   status: "FAIL",
    //   message: err.message,
    //   stack: err.stack, // I can return stack values, because i's not public function
    // };
  }
};

const getClient = () => pgPool.connect();

const poolEnd = async () => {
  if (pgPool == undefined) return;
  await pgPool.end();
  pgPool = undefined;
};

const pgEscape = (value) =>
  typeof value == "number"
    ? value.toString()
    : value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const pgEscapeQ = (value) =>
  value == undefined || value == null
    ? "NULL"
    : typeof value === "number"
    ? `${value}`
    : typeof value === "boolean"
    ? `${value ? "true" : "false"}`
    : "'" + value.replace(/'/g, "''") + "'";
const pgEscapeArr = (arr) => arr.map((e) => pgEscapeQ(e));
const pgValuesFromArr = (arr) => `(${arr.map((e) => pgEscapeQ(e)).join(", ")})`;

const trxWrap = async (opts, callbackfn) => {
  if (opts === undefined) opts = {};
  const logPrefix = `${opts.logPrefix ? opts.logPrefix : ""}`;

  if (pgPool == undefined) await updatePgConnection(opts);
  const isPrivateClient = opts.client ? false : true;
  const client = isPrivateClient ? await getClient() : opts.client;
  let transactionBeginned = false;
  let transactionPoint = undefined;
  try {
    if (isPrivateClient) {
      if (opts.debug > 9) console.log("%s BEGIN", logPrefix);
      await client.query("BEGIN");
      transactionBeginned = true;
    } else {
      transactionPoint = `stockAllocTransfer${+new Date()}`;
      if (opts.debug > 9) console.log("%s SAVEPOINT", logPrefix);
      await client.query(`SAVEPOINT ${transactionPoint}`);
    }
    // try-catch functionally block code BEGIN
    const response = await callbackfn(client);

    // try-catch functionally block code END
    if (isPrivateClient) {
      if (opts.debug > 9) console.log("%s COMMIT", logPrefix);
      await client.query("COMMIT");
      transactionBeginned = false;
    } else if (transactionPoint) {
      if (opts.debug > 9) console.log("%s RELEASE SAVEPOINT", logPrefix);
      await client.query(`RELEASE SAVEPOINT ${transactionPoint}`);
      transactionPoint = undefined;
    }
    return response;
  } catch (err) {
    console.error("%s Error: %s\nStack: %s", logPrefix, err.message, err.stack);
    if (transactionPoint) {
      if (opts.debug > 9) console.log("%s ROLLBACK TO SAVEPOINT", logPrefix);
      await client.query(`ROLLBACK TO ${transactionPoint}`);
      transactionPoint = undefined;
    }
    throw err; //bypass to upper function
  } finally {
    if (transactionPoint) {
      if (opts.debug > 9) console.log("%s ROLLBACK TO SAVEPOINT", logPrefix);
      await client.query(`ROLLBACK TO ${transactionPoint}`);
      transactionPoint = undefined;
    }
    if (isPrivateClient && transactionBeginned) {
      if (opts.debug > 9) console.log("%s ROLLBACK", logPrefix);
      await client.query("ROLLBACK");
      transactionBeginned = false;
    }
    if (isPrivateClient && client) {
      if (opts.debug > 9) console.log("%s CLIENT RELEASE", logPrefix);
      await client.release();
    }
  }
};

const printStats = (logPrefix = "") => {
  if (pgPool == undefined) {
    console.error("PG Pool not connected");
  }
  /*
  pool.totalCount: int
  The total number of clients existing within the pool.

  pool.idleCount: int
  The number of clients which are not checked out but are currently idle in the pool.

  pool.waitingCount: int
  The number of queued requests waiting on a client when all clients are checked out. It can be helpful to monitor this number to see if you need to adjust the size of the pool.  
  */
  console.log(
    "%sPG Pool stats count: i %s + w %s = T %s",
    logPrefix ? logPrefix + " " : "",
    pgPool.idleCount,
    pgPool.waitingCount,
    pgPool.totalCount
  );
};

module.exports = {
  escape: pgEscape,
  escapeQ: pgEscapeQ,
  escapeArr: pgEscapeArr,
  valuesFromArr: pgValuesFromArr,
  getClient,
  updatePgConnection: updatePgConnection,
  query: async (...param) => {
    await updatePgConnection({});
    return await pgPool.query(...param);
  },
  printStats,
  end: poolEnd,
  trxWrap,
};
