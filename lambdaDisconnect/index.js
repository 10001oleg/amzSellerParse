"use strict";

const { Client } = require("pg");

const sqlDeleteConnection = `
DELETE FROM wss WHERE conn_id = $1::text
`;
const handler = async (event) => {
  if (!process.env["DB_URI"]) {
    throw Error("NO DB_URI enviroment");
  }
  const client = new Client({ connectionString: process.env["DB_URI"] });
  await client.connect();
  try {
    const { connectionId } = event.requestContext;
    await client.query(sqlDeleteConnection, [connectionId]);
  } finally {
    await client.end();
  }
  return { statusCode: 200, body: "Disconnected." };
};

module.exports = { handler };
