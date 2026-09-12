import * as dev from './devAgent.js';
import * as general from './generalAgent.js';
import * as search from './searchAgent.js';

export const agents = {
  [dev.name]: dev,
  [general.name]: general,
  [search.name]: search,
};

export const agentNames = Object.keys(agents);
