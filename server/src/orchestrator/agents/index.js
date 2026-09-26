import * as dev from './devAgent.js';
import * as general from './generalAgent.js';
import * as search from './searchAgent.js';
import * as trading from './tradingAgent.js';
import * as video from './videoAgent.js';

export const agents = {
  [dev.name]: dev,
  [general.name]: general,
  [search.name]: search,
  [trading.name]: trading,
  [video.name]: video,
};

export const agentNames = Object.keys(agents);
