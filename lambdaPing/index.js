"use strict";

const AWS = require("aws-sdk");
const { Client } = require("pg");

const getSocketContext = async (event) => {
  const { domainName, stage, connectionId } = event.requestContext;
  const endpoint = `${domainName}/${stage}`;

  const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: "2018-11-29",
    endpoint,
  });

  const send = (data) =>
    apigwManagementApi
      .postToConnection({ ConnectionId: connectionId, Data: data })
      .promise();
  return { connectionId, endpoint, send };
};

const sql1 = `
SELECT * FROM "store"
`;
const handler = async (event /* , context*/) => {
  console.log("---event", event);
  const { send } = await getSocketContext(event);

  await send(
    JSON.stringify({ message: "This response was pushed from my Lambda." })
  );

  if (!process.env["DB_URI"]) {
    throw Error("NO DB_URI enviroment");
  }
  const client = new Client({ connectionString: process.env["DB_URI"] });
  await client.connect();
  try {
    const res = await client.query(sql1);
    await send(JSON.stringify(res.rows));
  } finally {
    await client.end();
  }

  return {
    isBase64Encoded: false,
    statusCode: 200,
    body: "",
  };
};

module.exports = { handler };
