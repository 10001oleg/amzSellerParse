"use strict";

const { stateCorrect } = require("../../lib/stateCorrection");

const xmlEscapeIllegalCharacters = (v) =>
  v.replace(/&(?!(?:apos|quot|[gl]t|amp);|#)/g, "&amp;");

const buildXmlAddress = (opts, objAddress, addResidential = true) => {
  /*
    "address": {
      "countryCode": "US", //optional, use "US" if not
      "postalCode": "91606-3537",
      "stateOrProvinceCode": "CA",
      "city": "NORTH HOLLYWOOD",
      "streetLine1": "3084 Santeetlah Rd",
      "streetLine2": "", // optional
      "streetLine3": "", // optional
      "residential": true
    }
    <ns:Address>
      ${objRequest.RequestedShipment.Recipient.Address.StreetLines?("<ns:StreetLines>"+objRequest.RequestedShipment.Recipient.Address.StreetLines+"</ns:StreetLines>"):""}
      ${objRequest.RequestedShipment.Recipient.Address.City?("<ns:City>"+objRequest.RequestedShipment.Recipient.Address.City+"</ns:City>"):""}
      ${objRequest.RequestedShipment.Recipient.Address.StateOrProvinceCode?("<ns:StateOrProvinceCode>"+objRequest.RequestedShipment.Recipient.Address.StateOrProvinceCode+"</ns:StateOrProvinceCode>"):""}
      <ns:PostalCode>${objRequest.RequestedShipment.Recipient.Address.PostalCode}</ns:PostalCode>
      <ns:CountryCode>${objRequest.RequestedShipment.Recipient.Address.CountryCode}</ns:CountryCode>
      <ns:Residential>${objRequest.RequestedShipment.Recipient.Address.Residential?"true":"false"}</ns:Residential>
    </ns:Address>
*/
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } getXmlAddress()`;
  if (opts && opts.isRates === true) {
    if (
      !(
        objAddress.postalCode ||
        (objAddress.stateOrProvinceCode &&
          objAddress.city &&
          objAddress.streetLine1)
      )
    ) {
      throw Error(
        logPrefix +
          " No field postalCode or (stateOrProvinceCode & city & streetLine1)"
      );
    }
  } else {
    // prettier-ignore
    {
    if (!objAddress.postalCode)          throw Error(logPrefix + " No field postalCode");
    if (!objAddress.stateOrProvinceCode) throw Error(logPrefix + " No field stateOrProvinceCode");
    if (!objAddress.city)                throw Error(logPrefix + " No field city");
    if (!objAddress.streetLine1)         throw Error(logPrefix + " No field streetLine1");
    if (addResidential && ! ("residential" in objAddress)) throw Error(logPrefix + " No field residential");
    }
  }

  // prettier-ignore
  return xmlEscapeIllegalCharacters(`  <ns:Address>
    ${objAddress.streetLine1?"<ns:StreetLines>"+objAddress.streetLine1+"</ns:StreetLines>":""}${
      objAddress.streetLine2?"<ns:StreetLines>"+objAddress.streetLine2+"</ns:StreetLines>":""
    }${
      objAddress.streetLine3?"<ns:StreetLines>"+objAddress.streetLine3+"</ns:StreetLines>":""
    }
    ${objAddress.city?"<ns:City>"+objAddress.city+"</ns:City>":""}
    ${objAddress.stateOrProvinceCode?"<ns:StateOrProvinceCode>"+stateCorrect(objAddress.stateOrProvinceCode)+"</ns:StateOrProvinceCode>":""}
    ${objAddress.postalCode?"<ns:PostalCode>"+objAddress.postalCode+"</ns:PostalCode>":""}
    <ns:CountryCode>${objAddress.countryCode?objAddress.countryCode:"US"}</ns:CountryCode>
    ${addResidential?"<ns:Residential>"+(objAddress.residential===true || objAddress.residential==="true"?"true":"false")+"</ns:Residential>":""}
  </ns:Address>
`);
};
const buildXmlContact = (opts, objContact) => {
  /*
    "contact": {
      "companyName": "my company name", //optional
      "name": "employee name",
      "phone": "employee phone",
      "email": "employee phone" //optional
    },
    <ns:Contact>
      <ns:PersonName>Eli Coen</ns:PersonName>
      <ns:CompanyName>EliCommerce</ns:CompanyName>
      <ns:PhoneNumber>310-310-1346</ns:PhoneNumber>
      <ns:EMailAddress>sender@yahoo.com</ns:EMailAddress>
    </ns:Contact>
*/
  // prettier-ignore
  let result = [];
  if ("name" in objContact)
    result.push(`<ns:PersonName>${objContact.name}</ns:PersonName>`);
  if ("companyName" in objContact)
    result.push(`<ns:CompanyName>${objContact.companyName}</ns:CompanyName>`);
  if ("phone" in objContact)
    result.push(`<ns:PhoneNumber>${objContact.phone}</ns:PhoneNumber>`);
  if ("phoneExtension" in objContact)
    result.push(
      `<ns:PhoneExtension>${objContact.phoneExtension}</ns:PhoneExtension>`
    );
  if ("email" in objContact)
    result.push(`<ns:EMailAddress>${objContact.email}</ns:EMailAddress>`);

  return xmlEscapeIllegalCharacters(`  <ns:Contact>
  ${result.join("\n  ")}
</ns:Contact>`);
};
const buildXmlPackageLineItemOne = (
  opts,
  objPackage,
  sequenceID,
  writeCustomerReference = false
) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } buildXmlPackageLineItemOne()`;
  // prettier-ignore
  {
  if (!objPackage.weight)              throw Error(logPrefix + " No field weight");
  if (!objPackage.dimensions)          throw Error(logPrefix + " No field dimensions");
  if (!objPackage.dimensions.length)   throw Error(logPrefix + " No field dimensions.length");
  if (!objPackage.dimensions.width)    throw Error(logPrefix + " No field dimensions.width");
  if (!objPackage.dimensions.height)   throw Error(logPrefix + " No field dimensions.height");
  }

  let strCustomerReferences = "";
  if (
    writeCustomerReference &&
    typeof objPackage.customerReferences == "object"
  ) {
    const customerReferences = [];
    Object.entries(objPackage.customerReferences).map(([key, value]) => {
      if (key == "invoiceNumber") {
        customerReferences.push(
          `<ns:CustomerReferences><ns:CustomerReferenceType>INVOICE_NUMBER</ns:CustomerReferenceType><ns:Value>${value}</ns:Value></ns:CustomerReferences>`
        );
      } else if (key == "customerReference") {
        customerReferences.push(
          `<ns:CustomerReferences><ns:CustomerReferenceType>CUSTOMER_REFERENCE</ns:CustomerReferenceType><ns:Value>${value}</ns:Value></ns:CustomerReferences>`
        );
      } else {
        console.error(
          "%s CRITICAL customerReferences type unknown %s = %s",
          logPrefix,
          key,
          value
        );
      }
    });
    if (customerReferences.length > 0) {
      strCustomerReferences = "\n" + customerReferences.join("\n");
    }
  }

  return `
<ns:RequestedPackageLineItems>
  <ns:SequenceNumber>${sequenceID}</ns:SequenceNumber>
  <ns:GroupPackageCount>1</ns:GroupPackageCount>
  <ns:Weight>
    <ns:Units>LB</ns:Units>
    <ns:Value>${objPackage.weight}</ns:Value>
  </ns:Weight>
  <ns:Dimensions>
    <ns:Length>${objPackage.dimensions.length.toFixed()}</ns:Length>
    <ns:Width>${objPackage.dimensions.width.toFixed()}</ns:Width>
    <ns:Height>${objPackage.dimensions.height.toFixed()}</ns:Height>
    <ns:Units>IN</ns:Units>
  </ns:Dimensions>${strCustomerReferences}
</ns:RequestedPackageLineItems>
`;
};

/**
 *
 * @param {Object} opts
 * @param {Object[]} objPackages
 * @param {number} sequenceIDstart
 * @param {boolean} writeCustomerReference
 */
const buildXmlPackageLineItems = (
  opts,
  objPackages,
  sequenceIDstart,
  writeCustomerReference = false
) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } buildXmlPackageLineItems()`;
  const optsStack = { ...opts, logPrefix };

  /*<ns:PackageCount>${
    objPackages.filter((e) => !("enabled" in e && e.enabled === false)).length
  }</ns:PackageCount>*/
  return `
  ${objPackages
    .filter((e) => !("enabled" in e && e.enabled === false))
    .map((p, i) =>
      buildXmlPackageLineItemOne(
        optsStack,
        p,
        i + (sequenceIDstart ? sequenceIDstart : 1),
        writeCustomerReference
      )
    )
    .join("\n")}
  `;
};
module.exports = {
  buildXmlContact,
  buildXmlAddress,
  buildXmlPackageLineItems,
};
