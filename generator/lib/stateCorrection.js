"use strict";

const data = [
  "AK##Alaska",
  "AL##Alabama",
  "AZ##Arizona",
  "AS##American Samoa",
  "CA##California",
  "FM##Federated States Of Micronesia",
  "AR##Arkansas",
  "DE##Delaware",
  "DC##District Of Columbia",
  "CO##Colorado",
  "GU##Guam",
  "GA##Georgia",
  "FL##Florida",
  "CT##Connecticut",
  "HI##Hawaii",
  "ID##Idaho",
  "IL##Illinois",
  "IN##Indiana",
  "IA##Iowa",
  "KY##Kentucky",
  "KS##Kansas",
  "LA##Louisiana",
  "ME##Maine",
  "MH##Marshall Islands",
  "MD##Maryland",
  "MA##Massachusetts",
  "MN##Minnesota",
  "MI##Michigan",
  "MS##Mississippi",
  "MO##Missouri",
  "MT##Montana",
  "NE##Nebraska",
  "NV##Nevada",
  "NH##New Hampshire",
  "NJ##New Jersey",
  "NM##New Mexico",
  "NC##North Carolina",
  "NY##New York",
  "MP##Northern Mariana Islands",
  "OH##Ohio",
  "ND##North Dakota",
  "OK##Oklahoma",
  "OR##Oregon",
  "PW##Palau",
  "PA##Pennsylvania",
  "PR##Puerto Rico",
  "RI##Rhode Island",
  "SD##South Dakota",
  "SC##South Carolina",
  "TN##Tennessee",
  "TX##Texas",
  "UT##Utah",
  "VT##Vermont",
  "VA##Virginia",
  "WA##Washington",
  "VI##Virgin Islands",
  "WV##West Virginia",
  "WI##Wisconsin",
  "WY##Wyoming",
];

/**
 * Return StateOrRegion CODE by CoDe or NaMe
 * @param {string} state StateOrRegion code or name
 * @return {string} state code
 */
const stateCorrect = (state) => {
  state = state.toUpperCase();
  for (let r of data) {
    const [n, a] = r.split("##");
    if (n.toUpperCase() == state) return n;
    if (a.toUpperCase() == state) return n;
  }
  const state2 = state.replace(/[^a-zA-Z]/g, "");
  if (state2 && state2.length == 2) {
    for (let r of data) {
      const [n, a] = r.split("##");
      if (n.toUpperCase() == state2) return n;
      if (a.toUpperCase() == state2) return n;
    }
  }
  throw Error(`Can not detect name of state ${state}`);
};

module.exports = { stateCorrect };
