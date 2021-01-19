"use strict";

const { Client } = require("pg");

const sqlInsertConnection = `
INSERT INTO wss(
    "conn_id",
    "data"
) VALUES (
    $1::text,
    $2
)
`;
const handler = async (event) => {
  if (!process.env["DB_URI"]) {
    throw Error("NO DB_URI enviroment");
  }
  console.log("----event ", event);
  const client = new Client({ connectionString: process.env["DB_URI"] });
  await client.connect();
  try {
    const { domainName, stage, connectionId } = event.requestContext;

    const { rows } = await client.query(sqlInsertConnection, [
      connectionId,
      JSON.stringify({ domainName, stage, connectionId }),
    ]);
    console.log("Response from PG: ", rows);
  } catch (err) {
    console.error(err.message);
    throw err;
  } finally {
    await client.end();
  }
  return { statusCode: 200, body: "Connected." };
};

module.exports = { handler };
