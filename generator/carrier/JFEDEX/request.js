"use strict";
const { request } = require("../../lib/request2");

const requestFedex = (opts, cred, params, body = "") => {
  return request(
    opts,
    {
      hostname:
        cred.environment && cred.environment === "sandbox"
          ? "wsbeta.fedex.com"
          : "ws.fedex.com",
      path: "/web-services",
      method: "POST",
      headers: {
        ...params.headers,
      },
      ...params,
    },
    {},
    body
  );
};

const xmlPreamble = (opts, account) => {
  return `
      <ns:WebAuthenticationDetail>
          <ns:UserCredential>
              <ns:Key>${account.cred.key}</ns:Key>
              <ns:Password>${account.cred.password}</ns:Password>
          </ns:UserCredential>
      </ns:WebAuthenticationDetail>
      <ns:ClientDetail>
          <ns:AccountNumber>${account.cred.account_number}</ns:AccountNumber>
          <ns:MeterNumber>${account.cred.meter_number}</ns:MeterNumber>
      </ns:ClientDetail>
  `;
};

module.exports = {
  requestFedex,
  xmlPreamble,
};
